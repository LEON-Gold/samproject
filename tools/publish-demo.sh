#!/bin/sh
# Publish web/ as the GitHub Pages demo (https://leon-gold.github.io/samproject/). Run from sam-app/ after committing.
set -e
git branch -D gh-pages >/dev/null 2>&1 || true
git subtree split --prefix web -b gh-pages
git -c http.version=HTTP/1.1 push -f origin gh-pages
gh api -X POST repos/LEON-Gold/samproject/pages/builds >/dev/null
echo "published: https://leon-gold.github.io/samproject/"
