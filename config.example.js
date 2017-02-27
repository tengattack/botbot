
import path from 'path'

const public_dir = path.join(__dirname, 'public')

const config = {
  sys: {
    public_dir,
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
