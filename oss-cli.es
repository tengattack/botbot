#!/usr/bin/env babel-node

import path from 'path'
import fs from 'fs'
import _ from 'lodash'
import { md5Async } from './lib/common'
import OSSClient from './lib/oss'
import CDNClient from './lib/cdn'
import config from './config'

function printHelpExit() {
  console.log('./oss-cli.es put [-c] [cdn_path] [file] [mime-type]')
  console.log('./oss-cli.es update [cdn_path] [file] [mime-type]')
  console.log('./oss-cli.es refresh [cdn_path]')
  console.log('./oss-cli.es delete [cdn_path]')
  console.log('./oss-cli.es list [cdn_path] [marker]')
  process.exit(1)
}

const args = {}
if (process.argv.length > 2) {
  args.type = process.argv[2]
  if ((args.type === 'put' || args.type === 'update') && process.argv.length > 4) {
    let i = 3
    if (process.argv === '-c') {
      // do continue upload
      args.continue = true
      i++
    }
    args.cdn_path = process.argv[i]
    args.file = process.argv[i + 1]
    if (process.argv.length > i + 2) {
      args.mimeType = process.argv[i + 2]
    }
  } else if (args.type === 'delete' && process.argv.length > 3) {
    args.cdn_path = process.argv[3]
  } else if (args.type === 'refresh' && process.argv.length > 3) {
    args.cdn_path = process.argv[3]
  } else if (args.type === 'list' && process.argv.length > 3) {
    args.cdn_path = process.argv[3]
    args.marker = process.argv[5] || ''
  } else {
    printHelpExit()
  }
} else {
  printHelpExit()
}

const cdnHost = config['build'].cdn_host
const oss = new OSSClient()
const cdn = new CDNClient()

function getFiles(dirpath) {
  let files = []
  const _files = fs.readdirSync(dirpath)
  for (const filePath of _files) {
    if (filePath.startsWith('.')) {
      continue
    }
    const f = path.join(dirpath, filePath)
    const stats = fs.statSync(f)
    if (stats.isDirectory()) {
      files = [ ...files, ...getFiles(f) ]
    } else {
      files.push(f)
    }
  }
  return files
}

function showProgress(written, total) {
  const s = written === total ? '100%' : (written * 100 / total).toFixed('1') + '%'
  process.stdout.write(s + '   \r')
}

async function upload(filePath, cdnPath, needUpdate) {
  const stat = fs.statSync(filePath)
  const bufForMD5 = fs.createReadStream(filePath)
  process.stdout.write(`hashing ${cdnPath}\r`)
  const md5 = await md5Async(bufForMD5, 'base64')
  console.log('uploading', cdnPath)
  const buf = fs.createReadStream(filePath)
  let bytesLoaded = 0
  buf.on('data', function (chunk) {
    showProgress(bytesLoaded, stat.size)
    bytesLoaded += chunk.length
  }).on('end', function () {
    showProgress(bytesLoaded, stat.size)
    bytesLoaded = stat.size
  })
  let r = await oss.put_buf(cdnPath, buf, args.mimeType, md5)
    .catch(err => {
      console.error(filePath, '=>', cdnPath, err)
    })
  showProgress(bytesLoaded, stat.size)
  if (needUpdate && r) {
    console.log('refreshing', cdnPath)
    r = await cdn.refreshCaches(cdnHost + '/' + cdnPath)
  }
  return r
}

async function main() {
  let r
  if (args.type === 'put' || args.type === 'update') {
    console.log('reading', args.file)
    const stats = fs.statSync(args.file)
    const isDirectory = stats.isDirectory()
    if (isDirectory) {
      let files = getFiles(args.file).sort()
      if (args.continue) {
        const existsFiles = await oss.list(args.cdn_path)
        files = _.difference(files, existsFiles)
      }
      for (const filePath of files) {
        let relativePath = path.relative(args.file, filePath)
        if (path.sep !== '/') {
          relativePath = relativePath.split(path.sep).join('/')
        }
        const cdnPath = args.cdn_path + relativePath
        r = await upload(filePath, cdnPath, args.type === 'update')
      }
    } else {
      r = await upload(args.file, args.cdn_path, args.type === 'update')
    }
  } else if (args.type === 'delete') {
    console.log('deleteing', args.cdn_path)
    r = await oss.delete(args.cdn_path)
  } else if (args.type === 'refresh') {
    console.log('refreshing', args.cdn_path)
    r = await cdn.refreshCaches(cdnHost + '/' + args.cdn_path)
  } else if (args.type === 'list') {
    console.log('listing', args.cdn_path)
    r = await oss.list(args.cdn_path, args.marker)
    console.log(r)
  }

  if (!r) {
    console.log('oss/cdn operation failed!')
  }

  console.log('done.')
}

function onerror(err) {
  console.error('Error:', err)
}

main().catch(onerror)
