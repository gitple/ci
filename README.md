
This is very simple CI(continuous integration) tool based on [node-github-hook](https://github.com/nlf/node-github-hook). It works with Github webhook.

How to use
---------------------
- Just run ci.sh as below. You can do it at /etc/rc.local to run at boot.
- Environment variables
  - `CI_PORT`: listening port number.
  - `CI_SECRET`: the secret set at your webhook configuration in Github.
- At the 1st run of ci.sh, npm modules are installed.
- The log file, `ci.log` is created; Place `ci.logrotate` file into /etc/logrotate.d/ after fixing the log path in it.
- Place your private key(`key.pem`) and certificate(`cert.pem`), otherwise they are generated as a self-signed one.

``` 
CI_PORT=51234 CI_SECRET={webhook secret} {path_to_ci_dir}/ci.sh
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

TODO
-------

- https connection support.
- queueing pull event while another event is already under way.
