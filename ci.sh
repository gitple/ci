#!/bin/bash

[ -z "$CI_PORT" ] && echo "CI_PORT: listening port is missing" && exit -1
[ -z "$CI_SECRET" ] && echo "CI_SECRET: secret is missing" && exit -1
[ -z "$CI_CONFIG" ] && echo "CI_CONFIG: config path is missing" && exit -1

#change to current dir
CUR_DIR=$(dirname $0)
cd $CUR_DIR;

if [ -n "$CI_LOG_FILE" ]; then
LOG_FILE="$CI_LOG_FILE"
else
LOG_FILE="ci.log"
fi

if [ -z "$CI_WEB_PORT" ]; then
CI_WEB_PORT=443
fi

LOG_ROTATE_SRC_FILE="ci.logrotate"
LOG_ROTATE_DST_FILE="/etc/etc/logrotate.d/ci"

if [ ! -f /etc/etc/logrotate.d/ci ]; then
  echo "Warning: logroate file is missing; Copy $LOG_ROTATE_SRC_FILE to $LOG_ROTATE_DST_FILE"
  #sudo cp -f $LOG_ROTATE_SRC_FILE $LOG_ROTATE_DST_FILE;
fi


#install githubhook
[ -d node_modules/ ] || npm install

if [ ! -f key.pem ]; then
  openssl genrsa -out key.pem 2048
  openssl req -new -key key.pem -config ci.cnf -out ci.csr
  openssl x509 -req -days 365 -in ci.csr -signkey key.pem -out cert.pem
  rm -f ci.csr
fi

#restart if already running.
RUNNIG_PID=`lsof -i :$CI_PORT | grep LISTEN | awk '{print $2}'`
[ -n "$RUNNIG_PID" ] && kill -9 "$RUNNIG_PID"

#run
nohup node app.js -p $CI_PORT -c $CI_CONFIG -s "$CI_SECRET" -l $LOG_FILE -w $CI_WEB_PORT &
