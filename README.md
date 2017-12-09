
This is very simple CI(continuous integration) tool based on [node-github-hook](https://github.com/nlf/node-github-hook). It works with Github webhook.

How to use
---------------------
## Before 1st time run, do the followings once.

### install modules

```
$ npm install
```

### generate self-signed cert

Place your private key(`key.pem`) and certificate(`cert.pem`), otherwise a self-signed cert is generated.

```
$ npm cert
```

### run 


- how to use

```
./app.js -h

  Usage: app [options]

  Options:
    -c, --config <path>    set config path. default ./config.json
    -p, --port <n>         listening port(required)
    -w, --webport <n>      web listing port. default 443
    -n, --files <n>        the max number of log files to keep. default 100
    -s, --secret <secret>  webhook secret. use CI_SECRET env if not defined
    -h, --help             output usage information
```

- example
  - scret
    The secret is the one set at your webhook configuration in Github. You can set it as command line option(`-s`) or `CI_SECRET` environment variable.
  - listing command logs
    You can set the port for listing command logs using the option(`-w`). The authentication id and password are as follows.
    - acesss url: `https://localhost:{webport}/`
    - basic auth
      - id: `admin`
      - password: {the secret}

```
$ CI_SECRET="secret" ./app.js -p 51234 -w 8443 -c ./config.json &
```

github webbhook setup
-------------------
## Github Webhooks settings: 

Your Repo -> Settings -> Webhooks

```
  Payload URL: http://your_ci_server.example.com:{ci listening port}/
  Content type: application/json
  Secret: **your_secret**
  [v] Just the push event.
  [v] Active
  Press "Disable SSL verification" on self-signed certification.
```

## Register deploy  key

Your Repo -> Settings -> Deploy keys

- generate your deploy key and register it.
  ```
  ssh-keygen
  ```

## Security group 

allow the ci listening port from github
  - 192.30.252.0/22 see: https://help.github.com/articles/what-ip-addresses-does-github-use-that-i-should-whitelist/

Config file
------------------

`config.json` file should be modified per your environemt.

## notificaiton
  - For now, only slack is supported.
  - webhookrul and channel should be provided.
## jobs
  - `jobs`: array of job. They are executed in order.
  - `repoPath` : repository path to run commands.
  - `targets` : string or array; matched when any of commited files starts with the given path; matched always when `*` is given.
  - `commands` : string or array; When any of targets are met, its commands are executed in order. When any command fails, it stops and notifies.

config.json
```
{
  "notification": {
    "selection": "slack",
    "slack": {
      "webhookurl": "your_webhook_url",
      "channel": "your_channel_to_be_notified"
    }
  },
  "repoPath": "_your_git_repo_path_to_build_and_test_",
  "jobs": [
    {
      "targets": "*",
      "commands": "git pull"
    },
    {
      "targets": [ "server/app", "server/lib" ],
      "commands": [ 
        "cd `git rev-parse --show-toplevel`/deploy; make app;",
        "cd `git rev-parse --show-toplevel`/deploy; sleep 5; npm test"]
    }
  ]
}
```

test
-----------

```
npm test
```
