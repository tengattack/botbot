
import apiRouter from './api'

const routers = [ apiRouter ]

export default function (app) {
  for (const router of routers) {
    app
      .use(router.routes())
      .use(router.allowedMethods())
  }
}
