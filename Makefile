APP := /Applications/Sandtable.app

.PHONY: install dmg
install:
	git pull --ff-only
	npm install
	npm run build:mac
	.githooks/pre-push
	npx electron-builder --mac dir -c.electronFuses.enableNodeCliInspectArguments=false
	osascript -e 'if application "Sandtable" is running then tell application "Sandtable" to quit'
	while pgrep -xq Sandtable; do sleep 1; done
	rm -rf $(APP)
	cp -R dist/mac-arm64/Sandtable.app $(APP)
	open $(APP)

dmg:
	npm run dist:mac
