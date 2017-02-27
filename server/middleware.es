
import bodyParser from 'koa-bodyparser'

const errorList = {
  400: 'Bad Request',
  404: 'Not Found',
}

export default function (app) {
  app.use(async (ctx, next) => {
    try {
      await next()
    } catch (e) {
      if (typeof e === 'number') {
        const errorCode = e
        ctx.status = errorCode
        ctx.body = { code: errorCode, message: errorList[errorCode] }
      } else {
        ctx.status = 500
        ctx.body = { code: 500, message: e.toString(), error: e }
      }
    }
  })
  app.use(bodyParser())
}
