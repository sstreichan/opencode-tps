.PHONY: install check version publish clean

install:
	npm install

# Bracket-balance check on tps.tsx. Naive (counts strings/comments too),
# but catches obvious editing mismatches. Not a linter.
check:
	@o=$$(tr -cd '{' < tps.tsx | wc -c); c=$$(tr -cd '}' < tps.tsx | wc -c); \
	 p=$$(tr -cd '(' < tps.tsx | wc -c); r=$$(tr -cd ')' < tps.tsx | wc -c); \
	 b=$$(tr -cd '[' < tps.tsx | wc -c); e=$$(tr -cd ']' < tps.tsx | wc -c); \
	 if [ "$$o" = "$$c" ] && [ "$$p" = "$$r" ] && [ "$$b" = "$$e" ]; then \
	   echo "Brackets OK: {}=$$o ()=$$p []=$$b"; \
	 else \
	   echo "MISMATCH: {}=$$o/$$c ()=$$p/$$r []=$$b/$$e"; exit 1; \
	 fi

# Auto-version v<MAJOR.MINOR>.<rev-count> from latest tag.
# Appends -dirty if tree is dirty. Modifies package.json but does not commit.
# No tags -> 0.1.<count>.
version:
	@cnt=$$(git rev-list --count HEAD); \
	 tag=$$(git describe --tags --abbrev=0 2>/dev/null || echo 0.1.0); \
	 base=$$(echo "$$tag" | sed 's/^v//' | cut -d. -f1-2); \
	 v="$$base.$$cnt"; \
	 if git status --porcelain | grep -q .; then v="$$v-dirty"; fi; \
	 sed -i 's/"version": "[^"]*"/"version": "'"$$v"'"/' package.json; \
	 echo "-> $$v"

publish: version
	npm publish

# Remove local artifacts. bun.lock included for safety (historical usage).
clean:
	rm -rf node_modules bun.lock
