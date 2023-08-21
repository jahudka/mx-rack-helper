.PHONY: default
default: rebuild

.PHONY: clean
clean:
	rm -rf build

.PHONY: build
build:
	node_modules/.bin/tsc

.PHONY: rebuild
rebuild: clean build
