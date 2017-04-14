
import fs from 'fs'
import request from 'request'

import { md5, base64, hmac_sha1, mime, file_ext } from './common'
import config from '../config'

export default class OSSClient {
  constructor(conf) {
    this.config = conf || config['oss']
    this.bucket = this.config.bucket
  }
  policy_signature(dir) {
    const { accessKeySecret } = this.config
    const timestamp = Date.now()
    const expiration = new Date(timestamp + 30 * 1000).toISOString()
    const conditions = [
      [ 'content-length-range', 0, 1048576000 ],
      [ 'starts-with', '$key', dir ],
    ]
    const policy = JSON.stringify({ expiration, conditions })
    const base64_policy = base64(policy)
    const signature = base64(hmac_sha1(accessKeySecret, base64_policy, ''))
    return { policy, signature }
  }
  signature(verb, resource, md5, type, d, ossHeaders, bucketName) {
    /*
    Signature = base64(hmac-sha1(AccessKeySecret,
              VERB + "\n"
              + Content-MD5 + "\n"
              + Content-Type + "\n"
              + Date + "\n"
              + CanonicalizedOSSHeaders
              + CanonicalizedResource))
    */
    const { accessKeySecret } = this.config
    if (!bucketName) {
      bucketName = this.bucket
    }

    let data = verb + '\n'
             + md5 + '\n'
             + type + '\n'
             + d.toGMTString() + '\n'
    // CanonicalizedOSSHeaders
    if (ossHeaders) {
      for (const key in ossHeaders) {
        data += `${key}:${ossHeaders[key]}\n`
      }
    }
    // CanonicalizedResource
    data += `/${bucketName}/${resource}`

    return base64(hmac_sha1(accessKeySecret, data, ''))
  }
  authorization(signature) {
    const { accessKeyId } = this.config
    return `OSS ${accessKeyId}:${signature}`
  }
  encodeName(resource) {
    return resource.replace(/[?&=]/g,
      c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  }
  url(resource, bucketName) {
    const { endpoint } = this.config
    if (!bucketName) {
      bucketName = this.bucket
    }
    resource = this.encodeName(resource)
    return `http://${bucketName}.${endpoint}/${resource}`
  }
  resp_promise_cb(resolve, reject, data) {
    return (err, resp, body) => {
      if (err) {
        reject(err)
      } else if ([ 200, 204 ].includes(resp.statusCode)) {
        resolve(data)
      } else {
        const e = {
          code: -1,
          message: 'unknown error',
        }
        if (body) {
          const codem = body.match(/<Code>(.*?)<\/Code>/)
          const msgm = body.match(/<Message>(.*?)<\/Message>/)
          if (codem) {
            e.code = codem[1]
          }
          if (msgm) {
            e.message = msgm[1]
          }
        }
        reject(e)
      }
    }
  }
  get_date_path(d) {
    const YYYY = d.getFullYear()
    let MM = (d.getMonth() + 1).toString()
    if (MM.length < 2) {
      MM = '0' + MM
    }
    let dd = d.getDate().toString()
    if (dd.length < 2) {
      dd = '0' + dd
    }
    return `${YYYY}${MM}/${dd}`
  }
  createBucket(name, acl = 'public-read', constraint = 'oss-cn-hangzhou') {
    const self = this
    return new Promise((resolve, reject) => {
      const d = new Date()
      const ossUrl = self.url('', name)
      const ossHeaders = {
        'x-oss-acl': acl,
      }
      const signature = self.signature('PUT', '', '', '', d, ossHeaders, name)
      const data = '<?xml version="1.0" encoding="UTF-8"?>\n'
                 + '<CreateBucketConfiguration>\n'
                 + '     <LocationConstraint>' + constraint + '</LocationConstraint>\n'
                 + '</CreateBucketConfiguration>'
      request({
        method: 'PUT',
        uri: ossUrl,
        headers: {
          'Date': d.toGMTString(),
          'Authorization': self.authorization(signature),
          ...ossHeaders,
        },
        body: data,
      }, self.resp_promise_cb(resolve, reject, { bucket: name }))
    })
  }
  removeBucket(name) {
    const self = this
    return new Promise((resolve, reject) => {
      const d = new Date()
      const ossUrl = self.url('', name)
      const signature = self.signature('DELETE', '', '', '', d, null, name)

      request({
        method: 'DELETE',
        uri: ossUrl,
        headers: {
          'Date': d.toGMTString(),
          'Authorization': self.authorization(signature),
        },
      }, self.resp_promise_cb(resolve, reject, true))
    })
  }
  put_buf(filename, data, mimeType) {
    const self = this
    return new Promise((resolve, reject) => {
      if (!mimeType) {
        const ext = file_ext(filename)
        mimeType = mime(ext)
      }
      const d = new Date()
      const ossUrl = self.url(filename)
      const signature = self.signature('PUT', filename, '', mimeType, d)

      request({
        method: 'PUT',
        uri: ossUrl,
        headers: {
          'Content-Length': data.length,
          'Content-Type': mimeType,
          'Date': d.toGMTString(),
          'Authorization': self.authorization(signature),
        },
        body: data,
      }, self.resp_promise_cb(resolve, reject, { resource: self.encodeName(filename) }))
    })
  }
  put(file, dir) {
    const self = this
    return new Promise((resolve, reject) => {
      fs.readFile(file, (err, data) => {
        if (err) {
          reject(err)
          return
        }

        const d = new Date()
        const fileMD5 = md5(data)
        const ext = file_ext(file)
        const mimeType = mime(ext)
        const datePath = self.get_date_path(d)

        const filename = `${dir}/${datePath}/${fileMD5}${ext}`

        self.put_buf(filename, data, mimeType)
            .then(resolve)
            .catch(reject)
      })
    })
  }
  delete(resource) {
    const self = this
    return new Promise((resolve, reject) => {
      const d = new Date()
      const ossUrl = self.url(resource)
      const signature = self.signature('DELETE', resource, '', '', d)

      request({
        method: 'DELETE',
        uri: ossUrl,
        headers: {
          'Date': d.toGMTString(),
          'Authorization': self.authorization(signature),
        },
      }, self.resp_promise_cb(resolve, reject, true))
    })
  }
}
