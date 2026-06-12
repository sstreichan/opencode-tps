.PHONY: install check version publish clean ls

NAME := @sstreichan/opencode-tps

install:
	npm install

check:
	node -e "const fs=require('fs');const s=fs.readFileSync('tps.tsx','utf8');const o=(s.match(/{/g)||[]).length;const c=(s.match(/}/g)||[]).length;const p=(s.match(/\(/g)||[]).length;const r=(s.match(/\)/g)||[]).length;const b=(s.match(/\[/g)||[]).length;const e=(s.match(/\]/g)||[]).length;console.log('Brackets: {}='+o+'/'+c+', ()='+p+'/'+r+', []='+b+'/'+e);console.log(o===c&&p===r&&b===e?'OK':'MISMATCH')"

version:
	node -e "\
	  const fs=require('fs');\
	  const {execSync}=require('child_process');\
	  const cnt=execSync('git rev-list --count HEAD').toString().trim();\
	  const tag=execSync('git describe --tags --abbrev=0 2>/dev/null || echo 0.1.0').toString().trim();\
	  const base=tag.replace(/^v/,'').split('.').slice(0,2).join('.');\
	  const v=base+'.'+cnt;\
	  const p=require('./package.json');\
	  p.version=v;\
	  fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');\
	  console.log('->',v)"

publish: version
	npm publish

clean:
	rm -rf node_modules bun.lock

ls:
	ls -la
