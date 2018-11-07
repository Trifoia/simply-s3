.PHONY: install lint

# Installs all dependencies
install:
	npm i

# Lints all files, and attempts to fix any that it can
lint:
	node ./node_modules/.bin/eslint . --fix
