
import request from 'request'

const GITHUB_API = 'https://api.github.com'
const USER_AGENT = 'pullscript/0.0.1'

export default class GithubClient {
  constructor(opts) {
    // access_token, etc...
    this.opts = opts || {}
  }
  request(method, uri, params, opts) {
    return new Promise((resolve, reject) => {
      const _opts = {
        method,
        uri: GITHUB_API + uri,
        ...opts,
        headers: {
          ...(opts && opts.headers),
          'User-Agent': USER_AGENT,
          'Authorization': 'token ' + this.opts.access_token,
        },
        json: true,
        gzip: true,
      }
      if (method === 'GET') {
        _opts.qs = params
      } else if (method === 'POST') {
        _opts.body = params
      }
      if (this.opts.proxy) {
        _opts.proxy = this.opts.proxy
      }
      request(_opts, function (err, resp, body) {
        if (err) {
          return reject(err)
        }
        resolve(body)
      })
    })
  }
  createIssueComment(repo, num, body) {
    return this.request('POST', '/repos/' + repo + '/issues/' + num + '/comments', { body })
  }
  getIssueComments(repo, num, page = 1) {
    return this.request('GET', '/repos/' + repo + '/issues/' + num + '/comments', { page })
  }
  getPullRequest(repo, num) {
    return this.request('GET', '/repos/' + repo + '/pulls/' + num)
  }
}
