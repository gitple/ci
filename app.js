#!/usr/bin/env node
'use strict';
var githubhook = require('githubhook');
var _ = require('lodash');
var os = require('os');
var fs = require('fs');
var process = require('process');
var logger = require('winston');
var async = require('async');
const spawn = require('child_process').spawn;
const execSync = require('child_process').execSync;
var program = require('commander');
require('winston-log-and-exit');

program
  .usage('[options]')
  .option('-c, --config <path>', 'set config path. defaults to ./config.json', './config.json')
  .option('-l, --log <path>', 'set config path. defaults to ./ci.log', './ci.log')
  .option('-p, --port <n>', 'listening port', parseInt)
  .option('-s, --secret <secret>', 'webhook secret. use CI_SECRET env if not defined')
  .parse(process.argv);
  if (!process.argv.slice(2).length || !program.port ||
    (!program.secret && !process.env.CI_SECRET)) {
    program.outputHelp();
    process.exit(1);
  }

logger.configure({
  exitOnError: false,
  transports: [
    new logger.transports.Console(),
    new logger.transports.File({ 
      handleExceptions: true,
      json: false,
      filename: program.log 
    })
  ]
});

var CFG;
try { CFG = require(program.config); } catch (e) {logger.error(e);}
if (!CFG) {
  logger.error('failure to load config: ' + program.config);
  process.exit(1);
}

var github,
  slack,
  slackChannel,
  repoPath,
  repoName,
  repoBranch,
  githubHookEvent,
  eventQueue = [],
  failLast = true;

if (_.get(CFG, 'notification.selection') === 'slack' && 
   CFG.notification.slack.webhookurl) {
  slack = require('slack-notify')(CFG.notification.slack.webhookurl);
  slackChannel = CFG.notification.slack.channel || 'ci';
}

repoPath = CFG.repoPath || process.cwd();
if (!repoPath || !fs.existsSync(repoPath)) {
  logger.error('check repoPath in config: ' + program.config);
  process.exit(1);
}

try {
  repoBranch = execSync(`git -C ${repoPath} rev-parse --abbrev-ref HEAD`).toString().trim();
  var orgUrl = execSync(`git -C ${repoPath} config --get remote.origin.url`).toString().trim();
  repoName = orgUrl.match(/([^/]+)\.git\s*$/)[1];
} catch (e){
  logger.error('failre to get repo branch or name', e.toString());
  process.exit(1);
}

githubHookEvent = `push:${repoName}:refs/heads/${repoBranch}`;

_.each(CFG.jobs, (j) => {
  if (!_.isArray(j.targets)) { j.targets = [j.targets]; }
  if (!_.isArray(j.commands)) { j.commands = [j.commands]; }
});


//logger.info('CFG', JSON.stringify(CFG));
function runCmd(cmd, changed, cb) {
  //FIXME: use spawn async
  
  process.chdir(repoPath);
  const rtn = spawn('/bin/bash', ['-c', cmd]);

  let stdout = '';
  let stderr = '';
  rtn.stdout.on('data', (data) => {
    stdout += data.toString();
  });
  rtn.stderr.on('data', (data) => {
    stderr += data.toString();
  });
  rtn.on('exit', (exitCode) => {
    logger.info('runCmd: ' + cmd);
    logger.info('STDOUT', stdout);
    if (exitCode !== 0) {
      logger.info('Error status=' + exitCode);
      logger.info('STDERR', stderr);
      if (slack) {
        slack.send({
          channel: '#' + slackChannel,
          text: [
          'STDOUT:', '```', stdout, '```', 
          'STDERR:', '```', stderr, '```', 
          'CHANGED:', '```', JSON.stringify(changed, null, 2), '```' ].join('\n'),
          username: 'ci-' + os.hostname()
        });
      }
      return cb(Error('Exit code=' + exitCode));
    } else {
      return cb();
    }
  });
}

function processQueue() {
  // ignore if underway
  if (processQueue.underway) { 
    logger.info('processQueue: underway');
    return; 
  }
  processQueue.underway = true;

  var data;
  async.whilst(
    function () {
      data = eventQueue.shift(); // dequeue
      return (!!data);
    },
    function (whilstDone) {
      var changed = [];
      _.each(data.commits, function(commit) {
        changed = _.union(changed, commit.added, commit.removed, commit.modified);
      });
      changed = _.sortBy(changed);

      logger.info('changed files=', changed);

      async.eachSeries(CFG.jobs, (j, seriesDone) => {
        let met = _.some(j.targets, (t) => {
          if (t === '*') { return true; }
          return _.some(changed, (v) => _.startsWith(v, t));
        });
        if (!met) { return seriesDone(); }
        async.eachSeries(j.commands, (cmd, cmdDone) => {
          runCmd(cmd, changed, cmdDone);
        }, function(err) {
          return seriesDone(err);
        });
      }, function(err){
        if (err) {
          failLast = true;
          logger.info('job done with error:', err.toString());
        } else {
          if (failLast === true) {
            if (slack) {
              slack.send({
                channel: '#' + slackChannel,
                text: ['OK - from the last failure', 
                  'CHNAGED:', '```', JSON.stringify(changed, null, 2), '```'].join('\n'),
                  username: 'ci-' + os.hostname()
              });
            }
          }
          failLast = false;
          logger.info('job done!');
        }
        whilstDone();
      });
    },
    function (err) { // all queues are processed
      if (err) {
        logger.error('processQueue: whilst done error', err);
      }
      processQueue.underway = false;
    }
  );
}

github = githubhook({
  port: program.port,
  secret: program.secret || process.env.CI_SECRET,
  path: '/',
  https: {
    key: fs.readFileSync('./key.pem'),
    cert: fs.readFileSync('./cert.pem')
  }
});

github.listen();

//function process(event, data) {
logger.info(`Wating for ${githubHookEvent} ...`);
github.on(githubHookEvent, function (data) {
  eventQueue.push(data); // enqueue
  processQueue();
});

process.on('uncaughtException', function (err) {
    logger.error('[uncaughtException]', err);
});
process.on('SIGTERM', function () {
    winston.log_and_exit('error', 'SIGTERM', 1);
});
process.on('exit', function () {
    winston.log_and_exit('error', 'exit called', 1);
});
