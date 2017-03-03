
import path from 'path'

const public_dir = path.join(__dirname, 'public')

const config = {
  sys: {
    public_dir,
  },
  client: {
    api_path: 'http://localhost:3009/api',
    timeout: 3 * 60 * 1000,
    url_maps: [
      { test: /example\/(\d+?)/i, replacer: 'd/$1' },
    ],
  },
  server: {
    hostname: '0.0.0.0',
    port: 3009,
    debug: true,
  },
  db: {
    host: 'localhost',
    user: 'test',
    password: 'secret',
    database: 'my_db',
  },
  cache: {
    // 10 minutes
    time: 10 * 60,
  },
  build: {
    cdn_host: 'static.example.com',
    cdn_path: 'assets/m/',
  },
  oss: {
    bucket: '[ossName]',
    accessKeyId: '[keyId]',
    accessKeySecret: '[keySecret]',
    endpoint: '[endpoint]',
  },
}

export default config
