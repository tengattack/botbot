import os from 'os'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import hat from 'hat'
import Queue from 'queue'
import phantomjs from 'phantomjs-prebuilt'
import req from '../lib/req'
import OSSClient from '../lib/oss'
import config from '../config'

const cpus = os.cpus().length
const concurrency = cpus * 1
const clientConfig = config['client']
const buildConfig = config['build']
const queue = new Queue({
  concurrency,
  timeout: clientConfig.timeout || 3 * 60 * 1000,
  autostart: true,
})
const oss = new OSSClient()

const GET_QUEUE_API = clientConfig.api_path + '/queue'
const UPDATE_QUEUE_API = clientConfig.api_path + '/update'
const ROOT_PATH = path.join(__dirname, '..')

const DATA_URL_REGEX = /\ssrc="data\:.*?"/gi
const EMBED_REGEX = /<embed[^>]*>/gi
const SCRIPT_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi

console.log('Concurrency: ' + concurrency)

queue.on('success', function (result, job) {
  const { url, resource } = result
  console.log('success', url, '=>', resource)
})

queue.on('error', function (err, job) {
  console.log('error', job.context.url, err)
})

queue.on('timeout', function (next, job) {
  console.log('timeout', job.context.url, job.stdout)
  job.phantom.kill()
  next()
})

function urlMap(url) {
  const urlMaps = clientConfig['url_maps']
  if (!urlMaps) {
    return url
  }
  for (const map of urlMaps) {
    if (map.test.test(url)) {
      url = url.replace(map.test, map.replacer)
    }
  }
  return url
}

function htmlFilter(html) {
  // remove script, embed, data-url
  return html.replace(SCRIPT_REGEX, '')
          .replace(EMBED_REGEX, '')
          .replace(DATA_URL_REGEX, '')
}

async function uploadToOss(url, host, path, html) {
  const ossPath = buildConfig['cdn_path'] + `${host}${path.endsWith('/') ? path + 'index.html' : path}`
  let r = await oss.put_buf(ossPath, new Buffer(html, 'utf8'), 'text/html')
  const resource_path = r.resource
  r = await req(UPDATE_QUEUE_API, { method: 'POST', json: true, body: { url, resource_path } })
  if (r.code !== 200) {
    console.log('Failed to update oss file, url: ' + url)
  }
  return resource_path
}

function newJob(q) {
  const runName = hat(64)
  const job = function (cb) {
    const phantom = spawn(phantomjs.path, [ 'browser.js', urlMap(q.url), runName ], { cwd: ROOT_PATH })
    job.phantom = phantom
    phantom.stdout.on('data', (data) => {
      job.stdout += data.toString()
    })
    phantom.stderr.on('data', (data) => {
      job.stderr += data.toString()
    })
    phantom.on('close', (code) => {
      // console.log(job.stdout)
      // if (job.stderr) {
      //   console.log(job.stderr)
      // }
      if (code === 0) {
        const filePath = path.join(ROOT_PATH, 'pages/' + runName + '.html')
        fs.readFile(filePath, 'utf8', function (err, data) {
          if (err) {
            return cb(err)
          }

          const html = htmlFilter(data)
          const { url, host, path } = q
          uploadToOss(url, host, path, html).then(resource => {
            cb(null, { url, resource })
          }).catch(err => {
            console.log('Failed to upload to OSS, url: ' + url)
            cb(err)
          })

          // remove html file
          fs.unlink(filePath, function () {})
        })
      } else {
        cb(job.stderr)
      }
    })
  }
  job.id = runName
  job.context = q
  job.stdout = ''
  job.stderr = ''
  return job
}

function addQueue(q) {
  queue.push(newJob(q))
}

async function main() {
  const body = await req(GET_QUEUE_API, { json: true })
  if (body && body.code === 200) {
    const { list } = body
    if (!list || list.length <= 0) {
      console.log('No queue currently.')
      return
    }
    for (const { host, path } of list) {
      const url = `http://${host}${path}`
      addQueue({ host, path, url })
    }
  } else {
    console.log('Failed to fetch queue.')
  }
}

main().catch(err => {
  console.log(err)
})
