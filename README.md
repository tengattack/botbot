# BotBot

A static page generator for search engines' bot.

## Author

tengattack

## Worker

```shell
cp config.example.js config.js
vi config.js # Edit the config file
```

### server-side

```shell
npm run server
```

### client-side (crontab)

```shell
npm run client
```

## Tools

### oss-cli

```shell
./oss-cli.es put [cdn_path] [file] [mime-type]
./oss-cli.es update [cdn_path] [file] [mime-type]
./oss-cli.es refresh [cdn_path]
./oss-cli.es delete [cdn_path]
```

### browser

```shell
phantomjs browser.js [options] [url] [name]
```

Then, it will generate HTML content and a screenshot to `pages` folder.

|    Options   |      Description      |
|:------------:|:---------------------:|
|   --mobile   | Set a mobile viewport |
| --screenshot |   Take a screenshot   |

## LICENSE

MIT
