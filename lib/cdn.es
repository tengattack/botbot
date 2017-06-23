
import fs from 'fs'
import request from 'request'

import { base64, hmac_sha1 } from './common'
import config from '../config'

const CDN_API = 'https://cdn.aliyuncs.com/'

export default class CDNClient {
  constructor(conf) {
    this.config = conf || config['oss']
    this.api = CDN_API
    this.version = '2014-11-11'
  }
  signature(verb, params) {
    const { accessKeyId, accessKeySecret } = this.config
    const nonce = Math.random().toString().substr(2)
    const d = new Date()
    const ISODate = d.toISOString().split('.')[0] + 'Z'
    params = {
      Format: 'JSON',
      Version: this.version,
      AccessKeyId: accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      TimeStamp: ISODate,
      SignatureVersion: '1.0',
      SignatureNonce: nonce,
      ...params,
    }
    const keysSorted = Object.keys(params).sort()
    let data = ''
    for (let k of keysSorted) {
      data += (data ? '&' : '') + k + '=' + encodeURIComponent(params[k])
    }
    const stringToSign = verb + '&' + encodeURIComponent('/')
                       + '&' + encodeURIComponent(data)

    params.Signature = base64(hmac_sha1(accessKeySecret + '&', stringToSign, ''))
    return params
  }
  resp_promise_cb(resolve, reject) {
    return (err, resp, body) => {
      if (err) {
        reject(err)
      } else if ([ 200, 204 ].includes(resp.statusCode)) {
        resolve(body)
      } else {
        const e = {
          code: -1,
          message: 'unknown error',
        }
        if (body) {
          e.code = body.Code
          e.message = body.Message
        }
        reject(e)
      }
    }
  }
  request(params) {
    const self = this
    return new Promise((resolve, reject) => {
      const form = self.signature('POST', params)

      request({
        method: 'POST',
        uri: this.api,
        headers: {
          'Content-Type': 'application/json',
        },
        json: true,
        gzip: true,
        form,
      }, self.resp_promise_cb(resolve, reject))
    })
  }
  describe() {
    return this.request({ Action: 'DescribeCdnService' })
  }
  // type: 'File', 'Directory'
  refreshCaches(path, type = 'File') {
    let objectPath
    if (path instanceof Array) {
      objectPath = path.join('\n')
    } else {
      objectPath = path
    }
    return this.request({
      Action: 'RefreshObjectCaches',
      ObjectPath: objectPath,
      ObjectType: type,
    })
  }
  setCertificate(domain, name, pubkey, privkey) {
    return this.request({
      Action: 'SetDomainServerCertificate',
      DomainName: domain,
      CertName: name,
      ServerCertificateStatus: 'on',
      ServerCertificate: pubkey,
      PrivateKey: privkey,
    })
  }
}
