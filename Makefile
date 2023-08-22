.PHONY: default
default: rebuild

.PHONY: clean
clean:
	rm -rf build

node_modules:
	npm ci

.PHONY: build
build: node_modules
	node_modules/.bin/tsc
	chmod +x build/cli.js

.PHONY: rebuild
rebuild: clean build
