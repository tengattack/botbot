
import request from 'request'

import { make_auth2 } from './common'

import config from '../config'

const USER_AGENT = 'pullscript/0.0.1'
const TIMEOUT = 5000

export default class PushService {
  constructor(opts) {
    // access_token, etc...
    this.opts = opts || config['pushservice'] || {}
  }
  requestPushApi(url, body) {
    return new Promise((resolve, reject) => {
      const opts = {
        method: 'POST',
        url: this.opts.url + url,
        headers: {
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
        },
        gzip: true,
        body: make_auth2(body, this.opts.key),
        timeout: TIMEOUT,
      }
      request(opts, (err, resp, body) => {
        if (err) {
          reject(err)
          return
        }
        try {
          body = JSON.parse(body)
          resolve(body)
        } catch (e) {
          reject(e)
        }
      })
    })
  }
  sendEmail(email, subject, body, template = '', payload = {}) {
    const emailObj = {
      to: email,
      subject,
      body,
      template,
      payload,
    }
    return this.requestPushApi('/api/email', {
      emails: [ emailObj ],
    })
  }
}
