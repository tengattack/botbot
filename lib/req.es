import request from 'request'

const USER_AGENT = 'BotBot/1.0'

export default function (uri, opts) {
  return new Promise((resolve, reject) => {
    request({
      method: 'GET',
      uri,
      gzip: true,
      headers: {
        'User-Agent': USER_AGENT,
      },
      ...opts,
    }, function (err, resp, body) {
        if (err) {
          reject(err)
        } else {
          resolve(body)
        }
      },
    )
  })
}
