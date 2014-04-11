#!/usr/bin/env bash
echo "--> Update GitHub remote repository"
if [ -z "$1" ]
then
	echo "*** Missing message, abort"
	exit 1
fi
git add .
git commit -m \'"$1"\'
git push -u origin master
git pull origin master
echo "--> Done"
exit 0
