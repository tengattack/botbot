'use strict';

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const request = require('request')

const configData = fs.readFileSync(path.join(__dirname, 'config.js'), { encoding: 'utf8' })
// get rpc key from config (es6)
const KEY = configData.match(/rpc_key: *'(.*?)'/)[1]

function base64(str) {
  return Buffer.from(str).toString('base64')
}

function hmac_sha256(secret_key, str, digest = 'hex') {
  return crypto.createHmac('sha256', secret_key).update(str).digest(digest)
}

function make_auth2(message) {
  const smsg = base64(JSON.stringify(message))
  const timestamp = Math.round(new Date().valueOf() / 1000).toString()
  const text = smsg + ' ' + timestamp
  const sign = hmac_sha256(KEY, text)

  return `${smsg} ${sign} ${timestamp}`
}

function main() {
  if (process.argv.length < 4) {
    console.error('Not enough process args')
    return
  }
  let json = process.argv[3]
  try {
    json = JSON.parse(json)
  } catch (e) {
    console.error('Not a valid json data')
    return
  }
  let uri = process.argv[2]
  let data = make_auth2(json)
  console.log(data)
  request({
    method: 'POST',
    uri,
    body: data,
    headers: {
      'Content-Type': 'text/plain'
    },
    gzip: true,
  }, function (err, resp, data) {
    if (err) {
      console.error(err)
      return
    }
    console.log('Response Code: ' + resp.statusCode)
    console.log(data)
  })
}

main()
