#!/usr/bin/env node
'use strict';
var githubhook = require('githubhook');
var _ = require('lodash');
var os = require('os');
var fs = require('fs');
var path = require('path');
var process = require('process');
var winston = require('winston');
var dateFormat = require('dateformat');
var async = require('async');
const spawn = require('child_process').spawn;
const execSync = require('child_process').execSync;
var program = require('commander');
require('winston-log-and-exit');

const DEFAULT_MAX_FILES = 100;
const DEFAULT_WEB_PORT = 443;

program
  .usage('[options]')
  .option('-c, --config <path>', 'set config path. default ./config.json', './config.json')
  .option('-p, --port <n>', 'listening port(required)', parseInt)
  .option('-w, --webport <n>', `web listing port. default ${DEFAULT_WEB_PORT}`, parseInt)
  .option('-n, --files <n>', `the max number of log files to keep. default ${DEFAULT_MAX_FILES}`, parseInt)
  .option('-s, --secret <secret>', 'webhook secret. use CI_SECRET env if not defined')
  .option('-a, --webauth <webauth>', 'web admin password. use CI_SECRET env if not defined')
  .parse(process.argv);
  if (!process.argv.slice(2).length || !program.port ||
    (!program.secret && !process.env.CI_SECRET)) {
    program.outputHelp();
    process.exit(1);
  }

  if (!program.files) {
    program.files = DEFAULT_MAX_FILES;
  }
  if (!program.webport) {
    program.webport = DEFAULT_WEB_PORT;
  }

winston.configure({
  exitOnError: false,
  transports: [
    new winston.transports.Console()
  ]
});

var CFG;
try { CFG = require(program.config); } catch (e) {winston.error(e);}
if (!CFG) {
  winston.error('failure to load config: ' + program.config);
  process.exit(1);
}

var github,
  slack,
  slackChannel,
  repoPaths,
  repoInfos = [],
  repoName,
  repoBranch,
  eventQueue = [],
  PUBLIC_DIR = `${__dirname}/public`,
  failLast = true;

if (_.get(CFG, 'notification.selection') === 'slack' && 
   CFG.notification.slack.webhookurl) {
  slack = require('slack-notify')(CFG.notification.slack.webhookurl);
  slackChannel = CFG.notification.slack.channel || 'ci';
}

repoPaths = CFG.repoPath || process.cwd();
if (!_.isArray(repoPaths)) { repoPaths = [repoPaths]; }

_.each(repoPaths, (repoPath) => {
  if (!repoPath || !fs.existsSync(repoPath)) {
    winston.error('check repoPath in config: ' + program.config);
    process.exit(1);
  }


  try {
    repoBranch = execSync(`git -C ${repoPath} rev-parse --abbrev-ref HEAD`).toString().trim();
    var orgUrl = execSync(`git -C ${repoPath} config -l |grep "^remote\..*\.url=" | cut -d'=' -f2`).toString().trim();
    repoName = orgUrl.match(/([^/]+)(\.git\s*$|$)/)[1];
  } catch (e){
    winston.error('failre to get repo branch or name', e.toString());
    process.exit(1);
  }

  repoInfos.push({
	  path: repoPath,
	  branch: repoBranch,
	  name: repoName,
	  hookevent: `push:${repoName}:refs/heads/${repoBranch}`,
  });
});

winston.info('=== Repo Infos ===');
winston.info(JSON.stringify(repoInfos));

_.each(CFG.jobs, (j) => {
  if (!_.isArray(j.targets)) { j.targets = [j.targets]; }
  if (!_.isArray(j.commands)) { j.commands = [j.commands]; }
});

if (!fs.existsSync(PUBLIC_DIR)){
    fs.mkdirSync(PUBLIC_DIR);
}

//winston.info('CFG', JSON.stringify(CFG));
function runCmd(cmd, repoInfo, changed, runLogger, cb) {
  //FIXME: use spawn async
  
  process.chdir(repoInfo.repoPath);
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
    runLogger.info('runCmd: ' + cmd);
    runLogger.info('STDOUT', stdout);
    if (exitCode !== 0) {
      runLogger.info('Error status=' + exitCode);
      runLogger.info('STDERR', stderr);
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
    winston.info('processQueue: underway');
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
      var runLogger = new winston.Logger();
      var filename = dateFormat(new Date(), 'isoDateTime');
      runLogger.add(winston.transports.File, { 
        filename: `${PUBLIC_DIR}/${filename}.log` ,
        json: false
      });

      var changed = [];
      _.each(data.commits, function(commit) {
        changed = _.union(changed, commit.added, commit.removed, commit.modified);
      });
      changed = _.sortBy(changed);

      runLogger.info('changed files=', changed);

      async.eachSeries(CFG.jobs, (j, seriesDone) => {
        //check repo name first
        var repoInfo = _.find(repoInfos, {name: _.get(data, 'repository.name')});
        if (j.repoName && ('*' != j.repoName && repoInfo.name != j.repoName )) { return seriesDone(); }
        //continue repoName is missing or matched
        let met = _.some(j.targets, (t) => {
          if (t === '*') { return true; }
          return _.some(changed, (v) => _.startsWith(v, t));
        });
        if (!met) { return seriesDone(); }
        async.eachSeries(j.commands, (cmd, cmdDone) => {
          runCmd(cmd, repoInfo, changed, runLogger, cmdDone);
        }, function(err) {
          return seriesDone(err);
        });
      }, function(err){
        if (err) {
          failLast = true;
          runLogger.info('job done with error:', err.toString());
        } else {
          if (failLast === true) {
            if (slack) {
              slack.send({
                channel: '#' + slackChannel,
                text: ['OK - from the last failure or 1st run', 
                  'CHNAGED:', '```', JSON.stringify(changed, null, 2), '```'].join('\n'),
                  username: 'ci-' + os.hostname()
              });
            }
          }
          failLast = false;
          runLogger.info('job done!');
        }
        runLogger.close();
        whilstDone();
      });
    },
    function (err) { // all queues are processed
      if (err) {
        winston.error('processQueue: whilst done error', err);
      }
      processQueue.underway = false;

      // keep only n files
      var files = fs.readdirSync(PUBLIC_DIR);
      if (_.size(files) <= program.files) { return; }
      files = _.sortBy(files, (f) => {
        return fs.statSync(path.join(PUBLIC_DIR, f)).ctime;
      });
      files = files.slice(0, _.size(files) - program.files);
      _.each(files, (f) => {
        fs.unlinkSync(path.join(PUBLIC_DIR, f));
      });
    }
  );
}

const httpsOptions = {
  key: fs.readFileSync('./key.pem'),
  cert: fs.readFileSync('./cert.pem')
};

github = githubhook({
  port: program.port,
  secret: program.secret || process.env.CI_SECRET,
  path: '/',
  https: httpsOptions,
});

github.listen();

//function process(event, data) {
_.each(repoInfos, (repoInfo) => {
  winston.info(`Wating for ${repoInfo.hookevent} ...`);
  github.on(repoInfo.hookevent, function (data) {
    eventQueue.push(data); // enqueue
  });
});

setInterval( () => {
  if (_.size(eventQueue) > 0) { 
    processQueue();
  }
}, 10*1000);
process.on('uncaughtException', function (err) {
    winston.error('[uncaughtException]', err);
});
process.on('SIGTERM', function () {
  winston.log_and_exit('error', 'SIGTERM', 1);
});
process.on('exit', function () {
    winston.log_and_exit('error', 'exit called', 1);
});



var https = require('https');
var express = require('express');
var serveIndex = require('serve-index');
var basicAuth = require('basic-auth-connect');

var app = express();

app.use(basicAuth('admin', program.webauth || process.env.CI_SECRET));
app.use(express.static(PUBLIC_DIR + '/'));
app.use('/', serveIndex(PUBLIC_DIR + '/', {icons: true, view: 'details'}));

const server = https.createServer(httpsOptions, app).listen(program.webport, () => {
  winston.log('log listing port: ' + program.webport);
});

