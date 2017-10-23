#!/bin/bash

[ -z "$CI_PORT" ] && echo "CI_PORT: listening port is missing" && exit -1
[ -z "$CI_SECRET" ] && echo "SECRET: secret is missing" && exit -1

#change to current dir
CUR_DIR=$(dirname $0)
cd $CUR_DIR;

LOG_FILE="ci.log"
LOG_ROTATE_SRC_FILE="ci.logrotate"
LOG_ROTATE_DST_FILE="/etc/etc/logrotate.d/ci"

if [ ! -f /etc/etc/logrotate.d/ci ]; then
  echo "Warning: logroate file is missing; Copy $LOG_ROTATE_SRC_FILE to $LOG_ROTATE_DST_FILE"
  #sudo cp -f $LOG_ROTATE_SRC_FILE $LOG_ROTATE_DST_FILE;
fi


#install githubhook
[ -d node_modules/ ] || npm install

#restart if already running.
RUNNIG_PID=`lsof -i :$CI_PORT | grep LISTEN | awk '{print $2}'`
[ -n "$RUNNIG_PID" ] && kill -9 "$RUNNIG_PID"

#run
nohup node app.js -p $CI_PORT > $LOG_FILE 2>&1 &
