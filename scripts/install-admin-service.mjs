import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

if(process.platform!=='darwin')throw Error('本脚本仅用于 macOS；其他系统使用 npm run admin');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const label='com.buy-great-things.admin';
const file=path.join(os.homedir(),'Library/LaunchAgents',`${label}.plist`);
if(fs.existsSync(file))throw Error('服务配置已存在；请使用 launchctl kickstart 重启已有服务');
const directory=path.join(root,'.local');fs.mkdirSync(directory,{recursive:true,mode:0o700});
const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const plist=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(root,'backend/server.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(`${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(path.join(directory,'admin.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(directory,'admin.stderr.log'))}</string>
</dict></plist>`;
fs.writeFileSync(file,plist,{mode:0o600});
try{execFileSync('launchctl',['bootstrap',`gui/${process.getuid()}`,file],{stdio:'pipe'});}catch{fs.rmSync(file,{force:true});throw Error('无法启动用户服务；本地后台仍可用 npm run admin 运行');}
console.log('后台服务已安装：http://127.0.0.1:4287/admin/');
