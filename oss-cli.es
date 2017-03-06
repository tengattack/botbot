#!/usr/bin/env babel-node

import path from 'path'
import fs from 'fs'
import OSSClient from './lib/oss'
import CDNClient from './lib/cdn'
import config from './config'

function printHelpExit() {
  console.log('./oss-cli.es put [cdn_path] [file] [mime-type]')
  console.log('./oss-cli.es update [cdn_path] [file] [mime-type]')
  console.log('./oss-cli.es refresh [cdn_path]')
  console.log('./oss-cli.es delete [cdn_path]')
  process.exit(1)
}

const args = {}
if (process.argv.length > 2) {
  args.type = process.argv[2]
  if ((args.type === 'put' || args.type === 'update') && process.argv.length > 4) {
    args.cdn_path = process.argv[3]
    args.file = process.argv[4]
    if (process.argv.length > 5) {
      args.mimeType = process.argv[5]
    }
  } else if (args.type === 'delete' && process.argv.length > 3) {
    args.cdn_path = process.argv[3]
  } else if (args.type === 'refresh' && process.argv.length > 3) {
    args.cdn_path = process.argv[3]
  } else {
    printHelpExit()
  }
} else {
  printHelpExit()
}

const cdnHost = config['build'].cdn_host
const oss = new OSSClient()
const cdn = new CDNClient()

function getFiles(dirpath) {
  let files = []
  const _files = fs.readdirSync(dirpath)
  for (const filePath of _files) {
    if (filePath.startsWith('.')) {
      continue
    }
    const f = path.join(dirpath, filePath)
    const stats = fs.statSync(f)
    if (stats.isDirectory()) {
      files = [ ...files, ...getFiles(f) ]
    } else {
      files.push(f)
    }
  }
  return files
}

async function main() {
  let r
  if (args.type === 'put' || args.type === 'update') {
    console.log('reading', args.file)
    const stats = fs.statSync(args.file)
    const isDirectory = stats.isDirectory()
    if (isDirectory) {
      const files = getFiles(args.file)
      for (const filePath of files) {
        const relativePath = path.relative(args.file, filePath)
        const cdnPath = args.cdn_path + relativePath
        const buf = fs.readFileSync(filePath)
        console.log('uploading', cdnPath)
        r = await oss.put_buf(cdnPath, buf, args.mimeType)
        if (args.type === 'update' && r) {
          console.log('refreshing', cdnPath)
          r = await cdn.refreshCaches(cdnHost + '/' + cdnPath)
        }
      }
    } else {
      const buf = fs.readFileSync(args.file)
      console.log('uploading', args.cdn_path)
      r = await oss.put_buf(args.cdn_path, buf, args.mimeType)
      if (args.type === 'update' && r) {
        console.log('refreshing', args.cdn_path)
        r = await cdn.refreshCaches(cdnHost + '/' + args.cdn_path)
      }
    }
  } else if (args.type === 'delete') {
    console.log('deleteing', args.cdn_path)
    r = await oss.delete(args.cdn_path)
  } else if (args.type === 'refresh') {
    console.log('refreshing', args.cdn_path)
    r = await cdn.refreshCaches(cdnHost + '/' + args.cdn_path)
  }

  if (!r) {
    console.log('oss/cdn operation failed!')
  }

  console.log('done.')
}

function onerror(err) {
  console.error('Error:', err)
}

main().catch(onerror)
