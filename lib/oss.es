
import fs from 'fs'
import request from 'request'
import xml2js from 'xml2js'
import ReadableStreamClone from 'readable-stream-clone'

import { md5, md5Async, base64, hmac_sha1, mime, file_ext } from './common'
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
    return encodeURIComponent(resource)
  }
  url(resource, query, bucketName) {
    const { endpoint } = this.config
    if (typeof query === 'string') {
      bucketName = query
      query = null
    }
    if (!bucketName) {
      bucketName = this.bucket
    }
    resource = this.encodeName(resource)
    if (query) {
      const qs = []
      for (const key in query) {
        qs.push(`${key}=${query[key]}`)
      }
      if (qs.length > 0) {
        resource += '?' + qs.join('&')
      }
    }
    return `http://${bucketName}.${endpoint}/${resource}`
  }
  resp_promise_cb(resolve, reject, data) {
    return (err, resp, body) => {
      if (err) {
        reject(err)
      } else if ([ 200, 204 ].includes(resp.statusCode)) {
        if (data) {
          resolve(data)
        } else {
          xml2js.parseString(body, (err, result) => {
            if (err) {
              return reject(err)
            }
            resolve(result)
          })
        }
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
        gzip: true,
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
        gzip: true,
      }, self.resp_promise_cb(resolve, reject, true))
    })
  }
  put_buf(filename, data, mimeType, md5 = '') {
    const self = this
    const p = (resolve, reject) => {
      if (!mimeType) {
        const ext = file_ext(filename)
        mimeType = mime(ext)
      }
      const d = new Date()
      const ossUrl = self.url(filename)
      const signature = self.signature('PUT', filename, md5, mimeType, d)

      request({
        method: 'PUT',
        uri: ossUrl,
        headers: {
          'Content-Length': data.length,
          'Content-Type': mimeType,
          'Content-MD5': md5,
          'Date': d.toGMTString(),
          'Authorization': self.authorization(signature),
        },
        body: data,
        gzip: true,
      }, self.resp_promise_cb(resolve, reject, { resource: self.encodeName(filename) }))
    }
    if (!md5) {
      const s1 = new ReadableStreamClone(data)
      const s2 = new ReadableStreamClone(data)
      data = s2
      return md5Async(s1, 'base64')
              .then(_md5 => {
                md5 = _md5
                return new Promise(p)
              })
    }
    return new Promise(p)
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

        self.put_buf(filename, data, mimeType, data)
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
        gzip: true,
      }, self.resp_promise_cb(resolve, reject, true))
    })
  }
  list(prefix, delimiter = '') {
    const self = this
    return new Promise((resolve, reject) => {
      const resource = '', maxKeys = 1000
      let marker = ''
      let files = []

      const p = function (result) {
        if (result && result.ListBucketResult) {
          const { IsTruncated, NextMarker, Contents } = result.ListBucketResult
          files = [ ...files, ...Contents.map(content => content.Key[0]) ]
          if (IsTruncated[0] === 'true') {
            marker = NextMarker[0]
          } else {
            return resolve(files)
          }
        }
        const d = new Date()
        const ossUrl = self.url(resource, {
          prefix, marker, delimiter, 'max-keys': maxKeys,
        })
        const signature = self.signature('GET', resource, '', '', d)
        request({
          method: 'GET',
          uri: ossUrl,
          headers: {
            'Date': d.toGMTString(),
            'Authorization': self.authorization(signature),
          },
          gzip: true,
        }, self.resp_promise_cb(p, reject))
      }

      p()
    })
  }
}
