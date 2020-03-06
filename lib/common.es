
import { spawn } from 'child_process'
import crypto from 'crypto'
import config from '../config'

function md5(str) {
  const md5 = crypto.createHash('md5')
  md5.update(str)
  return md5.digest('hex')
}
function md5Async(stream, encoding = 'hex') {
  return new Promise(function (resolve, reject) {
    const md5 = crypto.createHash('md5')
    md5.setEncoding(encoding)
    stream.on('end', function () {
      md5.end()
      resolve(md5.read())
    })
    stream.on('error', function (err) {
      reject(err)
    })
    stream.pipe(md5)
  })
}
function base64(str) {
  return Buffer.from(str).toString('base64')
}
function sha1(str) {
  const sha1 = crypto.createHash('sha1')
  sha1.update(str)
  return sha1.digest('hex')
}
function sha256(str) {
  const sha256 = crypto.createHash('sha256')
  sha256.update(str)
  return sha256.digest('hex')
}
function hmac_sha1(secret_key, str, digest = 'hex') {
  return crypto.createHmac('sha1', secret_key).update(str).digest(digest)
}
function hmac_sha256(secret_key, str, digest = 'hex') {
  return crypto.createHmac('sha256', secret_key).update(str).digest(digest)
}
function make_auth(message, key) {
  const smsg = base64(JSON.stringify(message))
  const timestamp = Math.round(new Date().valueOf() / 1000).toString()
  const text = smsg + ' ' + timestamp
  const sign = hmac_sha1(key, text)

  return `${smsg} ${sign} ${timestamp}`
}
function make_auth2(message, key) {
  const smsg = base64(JSON.stringify(message))
  const timestamp = Math.round(new Date().valueOf() / 1000).toString()
  const text = smsg + ' ' + timestamp
  const sign = hmac_sha256(key, text)

  return `${smsg} ${sign} ${timestamp}`
}

function string_clean(str) {
  return str.trim().toLowerCase()
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g,
    function (tag) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
        }[tag] || tag
    }
  )
}

function mime(ext) {
  let mimeType
  if (ext) {
    if (ext.startsWith('.')) {
      ext = ext.substr(1)
    }
    ext = ext.toLowerCase()
  }
  switch (ext) {
  case 'gif':
    mimeType = 'image/gif'
    break
  case 'jpg':
  case 'jpeg':
    mimeType = 'image/jpeg'
    break
  case 'png':
    mimeType = 'image/png'
    break
  case 'webp':
    mimeType = 'image/webp'
    break
  case 'js':
    mimeType = 'text/javascript'
    break
  case 'css':
    mimeType = 'text/css'
    break
  case 'htm':
  case 'html':
    mimeType = 'text/html'
    break
  case 'json':
    mimeType = 'application/json'
    break
  case 'mp4':
    mimeType = 'video/mp4'
    break
  case 'flv':
    mimeType = 'video/x-flv'
    break
  case 'mp3':
    mimeType = 'audio/mpeg'
    break
  default:
    mimeType = 'application/octet-stream'
    break
  }
  return mimeType
}

function file_ext(file) {
  const dotIndex = file.lastIndexOf('.')
  if (dotIndex >= 0) {
    return file.substr(dotIndex).toLowerCase()
  }
  return ''
}

function ii(s, len = 2, pad = '0') {
  s = s.toString()
  while (s.length < len) {
    s = pad + s
  }
  return s
}

/**
 * Format date to string
 *
 * @param {Date} d
 * @return {String} eg. 20190804
 */
function formatDate(d) {
  return `${d.getFullYear()}${ii(d.getMonth() + 1)}${ii(d.getDate())}`
}

function formatTime(ms, showHours = false) {
  const s = Math.floor(ms / 1000)
  let hour
  let min = Math.floor(s / 60)
  if (showHours) {
    hour = Math.floor(min / 60).toString()
    if (hour.length < 2) {
      hour = '0' + hour
    }
    min = (min % 60).toString()
    if (min.length < 2) {
      min = '0' + min
    }
  } else {
    min = min.toString()
  }
  let sec = (Math.floor(s) % 60).toString()
  if (sec.length < 2) sec = '0' + sec

  return showHours
          ? `${hour}:${min}:${sec}`
          : `${min}:${sec}`
}

function parseTime(stime, currentTime) {
  const sstime = stime.split(':')
  const d = new Date(currentTime)
  d.setHours(parseInt(sstime[0]))
  d.setMinutes(parseInt(sstime[1]))
  d.setSeconds(parseInt(sstime[2]))
  d.setMilliseconds(0)
  return d.valueOf()
}

function spawnAsync(command, args, opts) {
  console.log('$ ' + command + ' ' + args.join(' '))
  let print = true
  if (opts && 'print' in opts) {
    print = opts.print
    delete opts.print
  }
  return new Promise((resolve, reject) => {
    const cmd = spawn(command, args, opts)
    let stdout = ''
    let stderr = ''
    cmd.stdout.on('data', (data) => {
      if (print) process.stdout.write(data)
      stdout += data.toString()
    })
    cmd.stderr.on('data', (data) => {
      if (print) process.stdout.write(data)
      stderr += data.toString()
    })
    cmd.on('close', (code) => {
      const ret = {
        code,
        stdout,
        stderr,
      }
      if (code === 0) {
        resolve(ret)
      } else {
        reject(ret)
      }
    })
  })
}

export {
  md5,
  md5Async,
  base64,
  sha1,
  sha256,
  hmac_sha1,
  hmac_sha256,
  make_auth,
  make_auth2,
  escapeHTML,
  string_clean,
  mime,
  file_ext,
  formatDate,
  formatTime,
  parseTime,
  spawnAsync,
}
