import * as vscode from 'vscode';
import { createHash, KeyLike } from 'crypto';
import { EventEmitter } from 'events';
import { normalize, dirname, resolve } from 'path';
import { spawn, execSync } from 'child_process';

import { File } from './node_utility/File';
import { ResourceManager } from './ResourceManager';
import { FileWatcher } from './node_utility/FileWatcher';
import { Time } from './node_utility/Time';
import { CmdLineHandler } from './CmdLineHandler';

import { XMLParser } from 'fast-xml-parser';
import { readFileSync, writeFileSync, createWriteStream, readFile, readSync, ReadStream } from 'fs';

import iconv = require('iconv-lite');
import { fileURLToPath } from 'url';
import path = require('path');
import { encode } from 'punycode';
import { dir } from 'console';
import { openStdin } from 'process';
import { stringify } from 'querystring';

let myStatusBarItem: vscode.StatusBarItem;
let channel: vscode.OutputChannel;


export function activate(context: vscode.ExtensionContext) {

    console.log('---- keil-assistant actived ----');
    if (channel === undefined) {
        channel = vscode.window.createOutputChannel('keil-vscode');
    }
    // channel.show();
    // channel.appendLine("keil-assistant actived");

    // vscode.window.showInformationMessage(`---- keil-assistant actived ----`);
    // init resource
    ResourceManager.getInstance(context);

    const prjExplorer = new ProjectExplorer(context);
    const subscriber = context.subscriptions;

    const projectSwitchCommandId = 'project.switch';

    subscriber.push(vscode.commands.registerCommand('explorer.open', async () => {
        // channel.appendLine("[exporer]-> open dialog");
        const uri = await vscode.window.showOpenDialog({
            openLabel: 'Open a keil project',
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'keilProjectXml': ['uvproj', 'uvprojx']
            }
        });

        // channel.appendLine("[exporer]-> open dialog 1111");
        try {
            if (uri && uri.length > 0) {

                // load project
                const uvPrjPath = uri[0].fsPath;
                await prjExplorer.openProject(uvPrjPath);

                // switch workspace
                const result = await vscode.window.showInformationMessage(
                    'keil project load done !, switch workspace ?', 'Ok', 'Later');
                if (result === 'Ok') {
                    openWorkspace(new File(dirname(uvPrjPath)));
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`open project failed !, msg: ${(<Error>error).message}`);
        }
    }));

    subscriber.push(vscode.commands.registerCommand('explorer.update', () =>{
        prjExplorer.getProjectList()?.forEach((prj=>{
            prj.load();
        }));
        prjExplorer.updateView();
    }));
    
    subscriber.push(vscode.commands.registerCommand('project.close', (item: IView) => prjExplorer.closeProject(item.prjID)));

    subscriber.push(vscode.commands.registerCommand('project.build', (item: IView) => prjExplorer.getTarget(item)?.build()));

    subscriber.push(vscode.commands.registerCommand('project.rebuild', (item: IView) => prjExplorer.getTarget(item)?.rebuild()));

    subscriber.push(vscode.commands.registerCommand('project.download', (item: IView) => prjExplorer.getTarget(item)?.download()));

    subscriber.push(vscode.commands.registerCommand('item.copyValue', (item: IView) => vscode.env.clipboard.writeText(item.tooltip || '')));

    subscriber.push(vscode.commands.registerCommand(projectSwitchCommandId, (item: IView) => prjExplorer.switchTargetByProject(item)));

    subscriber.push(vscode.commands.registerCommand('project.active', (item: IView) => prjExplorer.activeProject(item)));

    subscriber.push(vscode.commands.registerCommand('statusbar.project', async () => {
        prjExplorer.statusBarSwitchTargetByProject();
    }));


    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 200);
    myStatusBarItem.command = 'statusbar.project';
    subscriber.push(myStatusBarItem);

    prjExplorer.loadWorkspace();
}

export function deactivate() {
    console.log('---- keil-assistant closed ----');
    channel.dispose();
}

//==================== Global Func===========================

function getMD5(data: string): string {
    const md5 = createHash('md5');
    md5.update(data);
    return md5.digest('hex');
}

function openWorkspace(wsFile: File) {
    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.parse(wsFile.toUri()));
}


function updateStatusBarItem(prjName: string | undefined): void {
    if (prjName !== undefined) {
        myStatusBarItem.text = prjName;
        myStatusBarItem.tooltip = "switch project target";
        myStatusBarItem.show();
    } else {
        myStatusBarItem.hide();
    }
}
//===============================

interface IView {

    label: string;

    prjID: string;

    icons?: { light: string, dark: string };

    tooltip?: string;

    contextVal?: string;

    getChildViews(): IView[] | undefined;
}

//===============================================

class Source implements IView {

    label: string;
    prjID: string;
    icons?: { light: string; dark: string; } | undefined;
    tooltip?: string | undefined;
    contextVal?: string | undefined = 'Source';

    //---
    readonly file: File;
    readonly enable: boolean;

    children: Source[] | undefined;

    constructor(pID: string, f: File, _enable = true) {
        this.prjID = pID;
        this.enable = _enable;
        this.file = f;
        this.label = this.file.name;
        this.tooltip = f.path;

        let iconName = '';
        if (f.isFile() === false) {
            iconName = 'FileWarning_16x';
        } else if (_enable === false) {
            iconName = 'FileExclude_16x';
        } else {
            iconName = this.getIconBySuffix(f.suffix.toLowerCase());
        }

        this.icons = {
            dark: iconName,
            light: iconName
        };
    }

    private getIconBySuffix(suffix: string): string {
        switch (suffix) {
            case '.c':
                return 'CFile_16x';
            case '.h':
            case '.hpp':
            case '.hxx':
            case '.inc':
                return 'CPPHeaderFile_16x';
            case '.cpp':
            case '.c++':
            case '.cxx':
            case '.cc':
                return 'CPP_16x';
            case '.s':
            case '.a51':
            case '.asm':
                return 'AssemblerSourceFile_16x';
            case '.lib':
            case '.a':
                return 'Library_16x';
            default:
                return 'Text_16x';
        }
    }

    getChildViews(): IView[] | undefined {
        return this.children;
    }
}

class FileGroup implements IView {

    label: string;
    prjID: string;
    tooltip?: string | undefined;
    contextVal?: string | undefined = 'FileGroup';
    icons?: { light: string; dark: string; };

    //----
    sources: Source[];

    constructor(pID: string, gName: string, disabled: boolean) {
        this.label = gName;
        this.prjID = pID;
        this.sources = [];
        this.tooltip = gName;
        const iconName = disabled ? 'FolderExclude_32x' : 'Folder_32x';
        this.icons = { light: iconName, dark: iconName };
    }

    getChildViews(): IView[] | undefined {
        return this.sources;
    }
}

interface KeilProjectInfo {

    prjID: string;

    vscodeDir: File;

    uvprjFile: File;

    logger: Console;

    toAbsolutePath(rePath: string): string;
}

interface KeilProperties {
    project: object | any | undefined;
}

interface UVisonInfo {
    schemaVersion: string | undefined;
}

class KeilProject implements IView, KeilProjectInfo {

    prjID: string;
    label: string;
    tooltip?: string | undefined;
    contextVal?: string | undefined = 'Project';
    icons?: { light: string; dark: string; } = {
        light: 'DeactiveApplication_16x',
        dark: 'DeactiveApplication_16x'
    };

    //-------------

    vscodeDir: File;
    uvprjFile: File;
    logger: Console;

    // uVison info
    uVsionFileInfo: UVisonInfo;

    activeTargetName: string | undefined;
    private prevUpdateTime: number | undefined;

    protected _event: EventEmitter;
    protected watcher: FileWatcher;
    protected targetList: Target[];

    keilVscodeProps: KeilProperties = {
        project: undefined,
    };

    constructor(_uvprjFile: File) {
        this._event = new EventEmitter();
        this.uVsionFileInfo = <UVisonInfo>{};
        this.targetList = [];
        this.vscodeDir = new File(_uvprjFile.dir + File.sep + '.vscode');
        this.vscodeDir.createDir();
        const logPath = this.vscodeDir.path + File.sep + 'keil-assistant.log';
        this.logger = new console.Console(createWriteStream(logPath, { flags: 'a+' }));
        this.uvprjFile = _uvprjFile;
        this.watcher = new FileWatcher(this.uvprjFile);
        this.prjID = getMD5(_uvprjFile.path);
        this.label = _uvprjFile.noSuffixName;
        this.tooltip = _uvprjFile.path;
        this.logger.log('[info] Log at : ' + Time.getInstance().getTimeStamp() + '\r\n');
        this.getKeilVscodeProperties();
        this.watcher.onChanged = () => {
            if (this.prevUpdateTime === undefined ||
                this.prevUpdateTime + 2000 < Date.now()) {
                this.prevUpdateTime = Date.now(); // reset update time
                setTimeout(() => this.onReload(), 300);
            }
        };
        this.watcher.watch();
    }

    on(event: 'dataChanged', listener: () => void): void;
    on(event: any, listener: () => void): void {
        this._event.on(event, listener);
    }

    private async onReload() {
        try {
            this.targetList.forEach((target) => target.close());
            this.targetList = [];
            await this.load();
            this.notifyUpdateView();
        } catch (error) {
            const err = (error as any).error;
            const code = err["code"];
            if (code === 'EBUSY') {
                this.logger.log(`[Warn] uVision project file '${this.uvprjFile.name}' is locked !, delay 500 ms and retry !`);
                setTimeout(() => this.onReload(), 500);
            } else {
                vscode.window.showErrorMessage(`reload project failed !, msg: ${err["message"]}`);
            }
        }
    }

    async load() {
        var doc: any = {};
        // channel.show();
        try {
            const parser = new XMLParser();
            const xmldoc = this.uvprjFile.read();
            doc = parser.parse(xmldoc);
        } catch (e) {
            console.error(e);
        }
        const targets = doc['Project']['Targets']['Target'];

        // init uVsion info
        this.uVsionFileInfo.schemaVersion = doc['Project']['SchemaVersion'];

        if (Array.isArray(targets)) {
            for (const target of targets) {
                this.targetList.push(Target.getInstance(this, this.uVsionFileInfo, target));
            }
        } else {
            this.targetList.push(Target.getInstance(this, this.uVsionFileInfo, targets));
        }

        for (const target of this.targetList) {
            await target.load();
            target.on('dataChanged', () => this.notifyUpdateView());
        }

        if (this.keilVscodeProps['project']['activeTargetName'] === undefined) {
            this.activeTargetName = this.targetList[0].targetName;
            this.updateKeilVscodeProperties();
        } else {
            this.activeTargetName = this.keilVscodeProps['project']['activeTargetName'];
        }

    }

    notifyUpdateView() {
        this._event.emit('dataChanged');
    }

    close() {
        this.watcher.close();
        this.targetList.forEach((target) => target.close());
        this.logger.log('[info] project closed: ' + this.label);
    }

    toAbsolutePath(rePath: string): string {
        const path = rePath.replace(/\//g, File.sep);
        if (/^[a-z]:/i.test(path)) {
            return normalize(path);
        }
        return normalize(this.uvprjFile.dir + File.sep + path);
    }

    active() {
        this.icons = { light: 'ActiveApplication_16x', dark: 'ActiveApplication_16x' };
    }

    deactive() {
        this.icons = { light: 'DeactiveApplication_16x', dark: 'DeactiveApplication_16x' };
    }

    getTargetByName(name: string): Target | undefined {
        const index = this.targetList.findIndex((t) => { return t.targetName === name; });
        if (index !== -1) {
            return this.targetList[index];
        }
    }

    setActiveTarget(tName: string) {
        if (tName !== this.activeTargetName) {
            this.activeTargetName = tName;
            this.updateKeilVscodeProperties();
            this.notifyUpdateView(); // notify data changed
        }
    }

    getActiveTarget(): Target | undefined {
        if (this.activeTargetName) {
            return this.getTargetByName(this.activeTargetName);
        }

        else if (this.targetList.length > 0) {
            return this.targetList[0];
        }
    }

    getChildViews(): IView[] | undefined {

        if (this.activeTargetName) {
            const target = this.getTargetByName(this.activeTargetName);
            if (target) {
                return [target];
            }
        }

        if (this.targetList.length > 0) {
            return [this.targetList[0]];
        }

        return undefined;
    }

    getTargets(): Target[] {
        return this.targetList;
    }


    private getDefKeilVscodeProperties(): KeilProperties {
        return {
            project: {
                name: undefined,
                activeTargetName: undefined
            },
        };
    }

    private getKeilVscodeProperties() {
        const proFile = new File(`${this.vscodeDir.path}${File.sep}keil_project_properties.json`);
        if (proFile.isFile()) {
            try {
                this.keilVscodeProps = JSON.parse(proFile.read());
            } catch (error) {
                this.logger.log(error);
                this.keilVscodeProps = this.getDefKeilVscodeProperties();
            }
        } else {
            this.keilVscodeProps = this.getDefKeilVscodeProperties();
        }
        return proFile;
    }

    private updateKeilVscodeProperties() {
        const proFile = this.getKeilVscodeProperties();

        const project = this.keilVscodeProps['project'];
        if (project?.name === this.prjID) {
            project.activeTargetName = this.activeTargetName;
        } else {
            project.name = this.prjID;
            project.activeTargetName = this.activeTargetName;
        }

        proFile.write(JSON.stringify(this.keilVscodeProps, undefined, 4));
    }

}

abstract class Target implements IView {

    prjID: string;
    label: string;
    tooltip?: string | undefined;
    contextVal?: string | undefined = 'Target';
    icons?: { light: string; dark: string; } = {
        light: 'Class_16x',
        dark: 'Class_16x'
    };

    //-------------

    readonly targetName: string;

    protected _event: EventEmitter;
    protected project: KeilProjectInfo;
    protected cppConfigName: string;
    protected targetDOM: any;
    protected uvInfo: UVisonInfo;
    protected fGroups: FileGroup[];
    protected includes: Set<string>;
    protected defines: Set<string>;

    private uv4LogFile: File;
    private uv4LogLockFileWatcher: FileWatcher;
    private isTaskRunning: boolean = false;

    constructor(prjInfo: KeilProjectInfo, uvInfo: UVisonInfo, targetDOM: any) {
        this._event = new EventEmitter();
        this.project = prjInfo;
        this.targetDOM = targetDOM;
        this.uvInfo = uvInfo;
        this.prjID = prjInfo.prjID;
        this.targetName = targetDOM['TargetName'];
        this.label = this.targetName;
        this.tooltip = this.targetName;
        this.cppConfigName = this.targetName;
        this.includes = new Set();
        this.defines = new Set();
        this.fGroups = [];
        this.uv4LogFile = new File(this.project.vscodeDir.path + File.sep + 'uv4.log');
        this.uv4LogLockFileWatcher = new FileWatcher(new File(this.uv4LogFile.path + '.lock'));

        if (!this.uv4LogLockFileWatcher.file.isFile()) { // create file if not existed
            this.uv4LogLockFileWatcher.file.write('');
        }

        this.uv4LogLockFileWatcher.watch();
        this.uv4LogLockFileWatcher.onChanged = () => this.updateSourceRefs();
        this.uv4LogLockFileWatcher.on('error', () => {

            this.uv4LogLockFileWatcher.close();

            if (!this.uv4LogLockFileWatcher.file.isFile()) { // create file if not existed
                this.uv4LogLockFileWatcher.file.write('');
            }

            this.uv4LogLockFileWatcher.watch();
        });
    }

    on(event: 'dataChanged', listener: () => void): void;
    on(event: any, listener: () => void): void {
        this._event.on(event, listener);
    }

    static getInstance(prjInfo: KeilProjectInfo, uvInfo: UVisonInfo, targetDOM: any): Target {
        if (prjInfo.uvprjFile.suffix.toLowerCase() === '.uvproj') {
            if (targetDOM['TargetOption']['Target251'] !== undefined) {
                return new C251Target(prjInfo, uvInfo, targetDOM);
            }
            return new C51Target(prjInfo, uvInfo, targetDOM);
        } else {
            return new ArmTarget(prjInfo, uvInfo, targetDOM);
        }
    }

    private getDefCppProperties(): any {
        return {
            configurations: [
                {
                    name: this.cppConfigName,
                    includePath: undefined,
                    defines: undefined,
                    intelliSenseMode: '${default}'
                }
            ],
            version: 4
        };
    }

    private updateCppProperties() {

        const proFile = new File(this.project.vscodeDir.path + File.sep + 'c_cpp_properties.json');
        let obj: any;

        if (proFile.isFile()) {
            try {
                obj = JSON.parse(proFile.read());
            } catch (error) {
                this.project.logger.log(error);
                obj = this.getDefCppProperties();
            }
        } else {
            obj = this.getDefCppProperties();
        }

        const configList: any[] = obj['configurations'];
        const index = configList.findIndex((conf) => { return conf.name === this.cppConfigName; });

        if (index === -1) {
            configList.push({
                name: this.cppConfigName,
                includePath: Array.from(this.includes).concat(['${default}', '${workspaceFolder}/**']),
                defines: Array.from(this.defines),
                intelliSenseMode: '${default}'
            });
        } else {
            configList[index]['includePath'] = Array.from(this.includes).concat(['${default}', '${workspaceFolder}/**']);
            configList[index]['defines'] = Array.from(this.defines);
        }

        proFile.write(JSON.stringify(obj, undefined, 4));
    }



    async load(): Promise<void> {

        // check target is valid
        const err = this.checkProject(this.targetDOM);
        if (err) { throw err; }

        const incListStr: string = this.getIncString(this.targetDOM);
        const defineListCopts:string[]|undefined = this.getComplieOptionsDefines(this.targetDOM);
        const defineListStr: string = this.getDefineString(this.targetDOM);
        const _groups: any = this.getGroups(this.targetDOM);
        const sysIncludes = this.getSystemIncludes(this.targetDOM);
        const deviceIncludes = this.getComplieOptionsIncludes(this.targetDOM);
        
        // set includes
        this.includes.clear();

        let incList = incListStr.split(';');
        if (sysIncludes) {
            incList = incList.concat(sysIncludes);
        }
        if(deviceIncludes){
            incList = incList.concat(deviceIncludes);
        }
        incList.forEach((path) => {
            const realPath = path.trim();
            if (realPath !== '') {
                this.includes.add(this.project.toAbsolutePath(realPath));
            }
        });

        // set defines
        this.defines.clear();

        // add user macros
        defineListStr.split(/,|\s+/).forEach((define) => {
            if (define.trim() !== '') {
                this.defines.add(define);
            }
        });
        defineListCopts?.forEach((define)=>{
            this.defines.add(define);
        });
        // add system macros
        this.getSysDefines(this.targetDOM).forEach((define) => {
            this.defines.add(define);
        });

        // set file groups
        this.fGroups = [];

        let groups: any[];
        if (Array.isArray(_groups)) {
            groups = _groups;
        } else {
            groups = [_groups];
        }

        for (const group of groups) {

            if (group['Files'] !== undefined) {

                let isGroupExcluded = false;
                let fileList: any[];
                // console.log('GroupOption',group['GroupOption']);
                const gOption = group['GroupOption'];
                if (gOption !== undefined) { // check group is excluded
                    const gComProps = gOption['CommonProperty'];
                    if (gComProps !== undefined) {
                        isGroupExcluded = (gComProps['IncludeInBuild'] === 0);
                    }
                }

                const nGrp = new FileGroup(this.prjID, group['GroupName'], isGroupExcluded);

                if (Array.isArray(group['Files'])) {
                    fileList = [];
                    for (const files of group['Files']) {
                        if (Array.isArray(files['File'])) {
                            fileList = fileList.concat(files['File']);
                        }
                        else if (files['File'] !== undefined) {
                            fileList.push(files['File']);
                        }
                    }
                } else {
                    if (Array.isArray(group['Files']['File'])) {
                        fileList = group['Files']['File'];
                    }
                    else if (group['Files']['File'] !== undefined) {
                        fileList = [group['Files']['File']];
                    } else {
                        fileList = [];
                    }
                }

                for (const file of fileList) {
                    const f = new File(this.project.toAbsolutePath(file['FilePath']));

                    let isFileExcluded = isGroupExcluded;
                    if (isFileExcluded === false && file['FileOption']) { // check file is enable
                        const fOption = file['FileOption']['CommonProperty'];
                        if (fOption && fOption['IncludeInBuild'] === 0) {
                            isFileExcluded = true;
                        }
                    }

                    const nFile = new Source(this.prjID, f, !isFileExcluded);
                    this.includes.add(f.dir);
                    nGrp.sources.push(nFile);
                }

                this.fGroups.push(nGrp);
            }
        }

        this.updateCppProperties();

        this.updateSourceRefs();
    }

    private async runAsyncTask(name: string, type: 'b' | 'r' | 'f' = 'b') {
        if (this.isTaskRunning) {
            vscode.window.showWarningMessage(`Task isRuning Please wait it finished try !`);
            return;
        }
        this.isTaskRunning = true;
        writeFileSync(this.uv4LogFile.path, '');
        // const cmd = `"${ResourceManager.getInstance().getKeilUV4Path()}" -${type} "${this.project.uvprjFile.path}" -j0 -t "${this.targetName}" -o "${this.uv4LogFile.path}"`;
        channel.clear();
        channel.show();
        channel.appendLine(`Start to ${name} target ${this.label}`);
        // const preLog = ` ${name} target ${this.label}`;

        // const timer = setInterval(async () => {
        //     const logst = readFileSync(this.uv4LogFile.path);
        //     channel.replace(`${iconv.decode(logst, 'cp936')}`);
        // }, 200);
        const execCommand = spawn(`${ResourceManager.getInstance().getKeilUV4Path()}`,
            [
                `-${type}`, `${this.project.uvprjFile.path}`,
                '-j0',
                '-t', `${this.targetName}`,
                '-o', `${this.uv4LogFile.path}`
            ],
            {
                cwd: resolve(__dirname, "./"),
                stdio: ['pipe', 'pipe', 'pipe']
            });

        return new Promise<void>(_res => {
            // console.log(`execCommand`, execCommand);
            // execCommand.stdout.on('data', (data) => {
            //     this.isTaskRunning = false;
            //     console.log(`stdout:${data}`);
            // });

            // execCommand.stderr.on('data', (data) => {
            //     this.isTaskRunning = false;
            //     console.error(`stderr:${data}`);
            // });

            execCommand.on('close', (code) => {
                this.isTaskRunning = false;
                console.log(`on close code:${code}`);
                const logst = readFileSync(this.uv4LogFile.path);
                channel.appendLine(`${iconv.decode(logst, 'cp936')}`);
            });

            // execCommand.on('exit', (code, signal)=>{
            //     console.log("exit", code, signal);
            // });
            /* setTimeout(() => {
                child_process.exec(cmd, { encoding:'binary' }, (err, stdout, stderr) => {
                    if (err) {
                        channel.appendLine(`Error: ${iconv.decode(Buffer.from(err.message, 'binary'),'cp936')}`);
                        channel.appendLine(`${iconv.decode(Buffer.from(stderr, 'binary'), 'cp936')}`);
                        this.isTaskRunning = false;
                        return;
                    }
                    this.isTaskRunning = false;
                    channel.appendLine(iconv.decode(Buffer.from(stdout, 'binary'), 'cp936'));
                }).once('exit', () => {
                    this.isTaskRunning = false;
                    const logst = readFileSync(this.uv4LogFile.path);
                    channel.appendLine(`${iconv.decode(logst, 'cp936')}`);
                });
            }, 500); */
        });
    }

    build() {
        this.runAsyncTask('Build', 'b');
    }

    rebuild() {
        this.runAsyncTask('Rebuild', 'r');
    }

    download() {
        this.runAsyncTask('Download', 'f');
    }

    updateSourceRefs() {
        const rePath = this.getOutputFolder(this.targetDOM);
        if (rePath) {
            const outPath = this.project.toAbsolutePath(rePath);
            this.fGroups.forEach((group) => {
                group.sources.forEach((source) => {
                    if (source.enable) { // if source not disabled
                        const refFile = File.fromArray([outPath, source.file.noSuffixName + '.d']);
                        if (refFile.isFile()) {
                            const refFileList = this.parseRefLines(this.targetDOM, refFile.read().split(/\r\n|\n/))
                                .map((rePath) => { return this.project.toAbsolutePath(rePath); });
                            source.children = refFileList.map((refFilePath) => {
                                return new Source(source.prjID, new File(refFilePath));
                            });
                        }
                    }
                });
            });
            this._event.emit('dataChanged');
        }
    }

    close() {
        this.uv4LogLockFileWatcher.close();
    }

    getChildViews(): IView[] | undefined {
        return this.fGroups;
    }

    protected abstract checkProject(target: any): Error | undefined;

    protected abstract getIncString(target: any): string;
    protected abstract getDefineString(target: any): string;
    protected abstract getSysDefines(target: any): string[];
    protected abstract getGroups(target: any): any[];
    protected abstract getSystemIncludes(target: any): string[] | undefined;
    protected abstract getComplieOptionsIncludes(target: any): string[] | undefined;
    protected abstract getComplieOptionsDefines(target: any): string[] | undefined;
    protected abstract getOutputFolder(target: any): string | undefined;
    protected abstract parseRefLines(target: any, lines: string[]): string[];

    protected abstract getProblemMatcher(): string[];
    // protected abstract getBuildCommand(): string[];
    // protected abstract getRebuildCommand(): string[];
    // protected abstract getDownloadCommand(): string[];
}

//===============================================

class C51Target extends Target {

    protected checkProject(target: any): Error | undefined {
        if (target['TargetOption']['Target51'] === undefined ||
            target['TargetOption']['Target51']['C51'] === undefined) {
            return new Error(`This uVision project is not a C51 project, but have a 'uvproj' suffix !`);
        }

    }
    protected getComplieOptionsIncludes(target: any): string[] | undefined {
        return undefined;
    }
    protected parseRefLines(_target: any, _lines: string[]): string[] {
        return [];
    }

    protected getOutputFolder(_target: any): string | undefined {
        return undefined;
    }

    protected getSysDefines(_target: any): string[] {
        return [
            '__C51__',
            '__VSCODE_C51__',
            'reentrant=',
            'compact=',
            'small=',
            'large=',
            'data=',
            'idata=',
            'pdata=',
            'bdata=',
            'xdata=',
            'code=',
            'bit=char',
            'sbit=char',
            'sfr=char',
            'sfr16=int',
            'sfr32=int',
            'interrupt=',
            'using=',
            '_at_=',
            '_priority_=',
            '_task_='
        ];
    }

    protected getSystemIncludes(target: any): string[] | undefined {
        const keilRootDir = new File(ResourceManager.getInstance().getKeilRootDir());
        const vendor = target['TargetOption']['TargetCommonOption']['Vendor'];
        const list = [];
        if (keilRootDir.isDir()) {
            const c51Inc = `${keilRootDir.path}${File.sep}C51${File.sep}INC`;
            const vendorInc = `${c51Inc}${File.sep}${vendor}`;
            const vendorDirFile = new File(vendorInc);
            list.push(c51Inc);
            if (vendorDirFile.isExist() && vendorDirFile.isDir()) {
                list.push(vendorInc);
            }
            return list;
        }
        return undefined;
    }

    protected getIncString(target: any): string {
        const target51 = target['TargetOption']['Target51']['C51'];
        return target51['VariousControls']['IncludePath'];
    }

    protected getDefineString(target: any): string {
        const target51 = target['TargetOption']['Target51']['C51'];
        return target51['VariousControls']['Define'];
    }

    protected getGroups(target: any): any[] {
        return target['Groups']['Group'] || [];
    }

    protected getProblemMatcher(): string[] {
        return ['$c51'];
    }

    protected getComplieOptionsDefines(target: any): string[] | undefined{
        return undefined;
    }
    /*
    protected getBuildCommand(): string[] {
        return [
            '--uv4Path', ResourceManager.getInstance().getC51UV4Path(),
            '--prjPath', this.project.uvprjFile.path,
            '--targetName', this.targetName,
            '-c', '${uv4Path} -b ${prjPath} -j0 -t ${targetName}'
        ];
    }

    protected getRebuildCommand(): string[] {
        return [
            '--uv4Path', ResourceManager.getInstance().getC51UV4Path(),
            '--prjPath', this.project.uvprjFile.path,
            '--targetName', this.targetName,
            '-c', '${uv4Path} -r ${prjPath} -j0 -t ${targetName}'
        ];
    }

    protected getDownloadCommand(): string[] {
        return [
            '--uv4Path', ResourceManager.getInstance().getC51UV4Path(),
            '--prjPath', this.project.uvprjFile.path,
            '--targetName', this.targetName,
            '-c', '${uv4Path} -f ${prjPath} -j0 -t ${targetName}'
        ];
    }
    */
}

class C251Target extends Target {

    protected checkProject(target: any): Error | undefined {
        if (target['TargetOption']['Target251'] === undefined ||
            target['TargetOption']['Target251']['C251'] === undefined) {
            return new Error(`This uVision project is not a C251 project, but have a 'uvproj' suffix !`);
        }

    }

    protected parseRefLines(_target: any, _lines: string[]): string[] {
        return [];
    }

    protected getOutputFolder(_target: any): string | undefined {
        return undefined;
    }

    protected getSysDefines(_target: any): string[] {
        return [
            '__C251__',
            '__VSCODE_C251__',
            'reentrant=',
            'compact=',
            'small=',
            'large=',
            'data=',
            'idata=',
            'pdata=',
            'bdata=',
            'edata=',
            'xdata=',
            'code=',
            'bit=char',
            'sbit=char',
            'sfr=char',
            'sfr16=int',
            'sfr32=int',
            'interrupt=',
            'using=',
            'far=',
            '_at_=',
            '_priority_=',
            '_task_='
        ];
    }

    protected getSystemIncludes(target: any): string[] | undefined {
        const keilRootDir = new File(ResourceManager.getInstance().getKeilRootDir());
        const vendor = target['TargetOption']['TargetCommonOption']['Vendor'];
        const list = [];
        if (keilRootDir.isDir()) {
            const c251Inc = `${keilRootDir.path}${File.sep}C251${File.sep}INC`;
            const vendorInc = `${c251Inc}${File.sep}${vendor}`;
            const vendorDirFile = new File(vendorInc);
            list.push(c251Inc);
            if (vendorDirFile.isExist() && vendorDirFile.isDir()) {
                list.push(vendorInc);
            }
            return list;
        }
        return undefined;
    }

    protected getIncString(target: any): string {
        const target51 = target['TargetOption']['Target251']['C251'];
        return target51['VariousControls']['IncludePath'];
    }

    protected getDefineString(target: any): string {
        const target51 = target['TargetOption']['Target251']['C251'];
        return target51['VariousControls']['Define'];
    }

    protected getGroups(target: any): any[] {
        return target['Groups']['Group'] || [];
    }

    protected getProblemMatcher(): string[] {
        return ['$c251'];
    }
    protected getComplieOptionsIncludes(target: any): string[] | undefined {
        return undefined;
    }

    protected getComplieOptionsDefines(target: any): string[] | undefined{
        return undefined;
    }
    /*
    protected getBuildCommand(): string[] {
        return [
            '--uv4Path', ResourceManager.getInstance().getC251UV4Path(),
            '--prjPath', this.project.uvprjFile.path,
            '--targetName', this.targetName,
            '-c', '${uv4Path} -b ${prjPath} -j0 -t ${targetName}'
        ];
    }

    protected getRebuildCommand(): string[] {
        return [
            '--uv4Path', ResourceManager.getInstance().getC251UV4Path(),
            '--prjPath', this.project.uvprjFile.path,
            '--targetName', this.targetName,
            '-c', '${uv4Path} -r ${prjPath} -j0 -t ${targetName}'
        ];
    }

    protected getDownloadCommand(): string[] {
        return [
            '--uv4Path', ResourceManager.getInstance().getC251UV4Path(),
            '--prjPath', this.project.uvprjFile.path,
            '--targetName', this.targetName,
            '-c', '${uv4Path} -f ${prjPath} -j0 -t ${targetName}'
        ];
    }
    */
}

class MacroHandler {
    private regMatchers = {
        'normalMacro': /^#define (\w+) (.*)$/,
        'funcMacro': /^#define (\w+\([^\)]*\)) (.*)$/
    };

    toExpression(macro: string): string | undefined {

        let mList = this.regMatchers['normalMacro'].exec(macro);
        if (mList && mList.length > 2) {
            return `${mList[1]}=${mList[2]}`;
        }

        mList = this.regMatchers['funcMacro'].exec(macro);
        if (mList && mList.length > 2) {
            return `${mList[1]}=`;
        }
    }
}

class ArmTarget extends Target {

    constructor(prjInfo: KeilProjectInfo, uvInfo: UVisonInfo, targetDOM: any) {
        super(prjInfo, uvInfo, targetDOM);
        ArmTarget.initArmclangMacros();
    }

    protected hasComplied():boolean{

        return false;
    };

    private getLstFile():File|undefined
    {
        let lstABSPath = this.targetDOM['TargetOption']["TargetCommonOption"]['ListingPath'];
        lstABSPath = this.project.toAbsolutePath(lstABSPath);
        const lstDir = new File(lstABSPath);
        if(lstDir.isExist()){
            let files = lstDir.getList([/.lst$/], [/ /]);
            if(files.length>0)
            {
                return files[0];
            }
        }
        return undefined;
    }
    
    private getDepFile():File|undefined
    {
        let objABSPath = this.getOutputFolder(this.targetDOM);
        if(objABSPath)
        {
            objABSPath = this.project.toAbsolutePath(objABSPath);
            const objDir = new File(objABSPath);
            if(objDir.isExist()){
                const depName = this.project.uvprjFile.noSuffixName+'_'+<string>this.targetName;
                const reg = new RegExp(depName +".dep","g");
                let files = objDir.getList([reg], [/ /]);
                if(files.length>0)
                {
                    return files[0];
                }
            }
        }
        return undefined;
    }

    private getComplieOptions(target: any):string | undefined{
        const depFile = this.getDepFile();        
        // const reg = new RegExp(/(?<=CompilerVersion: )(.*?)(?=-o)/g);
        //match a asembly file
        const fileReg = /(?<=^F \().*(?=\.s\)\(0x\w+\))/;
        let optionsStr:string = ""; 
        let stateCheckF:boolean=false;
        if(depFile){
            let content = readFileSync(depFile.path);
            const lines = content.toString().split(/\r\n|\r\r/);
            for(let line of lines){
                if(!stateCheckF){    
                    if(/^F /.test(line)&&(!fileReg.test(line))){
                        stateCheckF=true;
                        optionsStr = optionsStr.concat(line).concat(' ');
                    }
                }
                else {
                    if(/^I \(/.test(line)){
                        return optionsStr;
                    }
                    optionsStr = optionsStr.concat(line).concat(' ');
                }
            };
            // content = content.replace(/(\r\n)+/g,' ');
            // content = content.replace(/(\r\r)+/g,' ');
            // const matchs = content.toString().match(reg);
            // if(matchs){
            //     return matchs[0];
            // }
        }
    return undefined;
}

    private static readonly armccMacros: string[] = [
        '__CC_ARM',
        '__arm__',
        '__align(x)=',
        '__ALIGNOF__(x)=',
        '__alignof__(x)=',
        '__asm(x)=',
        '__forceinline=',
        '__restrict=',
        '__global_reg(n)=',
        '__inline=',
        '__int64=long long',
        '__INTADDR__(expr)=0',
        '__irq=',
        '__packed=',
        '__pure=',
        '__smc(n)=',
        '__svc(n)=',
        '__svc_indirect(n)=',
        '__svc_indirect_r7(n)=',
        '__value_in_regs=',
        '__weak=',
        '__writeonly=',
        '__declspec(x)=',
        '__attribute__(x)=',
        '__nonnull__(x)=',
        '__register=',

        '__breakpoint(x)=',
        '__cdp(x,y,z)=',
        '__clrex()=',
        '__clz(x)=0U',
        '__current_pc()=0U',
        '__current_sp()=0U',
        '__disable_fiq()=',
        '__disable_irq()=',
        '__dmb(x)=',
        '__dsb(x)=',
        '__enable_fiq()=',
        '__enable_irq()=',
        '__fabs(x)=0.0',
        '__fabsf(x)=0.0f',
        '__force_loads()=',
        '__force_stores()=',
        '__isb(x)=',
        '__ldrex(x)=0U',
        '__ldrexd(x)=0U',
        '__ldrt(x)=0U',
        '__memory_changed()=',
        '__nop()=',
        '__pld(...)=',
        '__pli(...)=',
        '__qadd(x,y)=0',
        '__qdbl(x)=0',
        '__qsub(x,y)=0',
        '__rbit(x)=0U',
        '__rev(x)=0U',
        '__return_address()=0U',
        '__ror(x,y)=0U',
        '__schedule_barrier()=',
        '__semihost(x,y)=0',
        '__sev()=',
        '__sqrt(x)=0.0',
        '__sqrtf(x)=0.0f',
        '__ssat(x,y)=0',
        '__strex(x,y)=0U',
        '__strexd(x,y)=0',
        '__strt(x,y)=',
        '__swp(x,y)=0U',
        '__usat(x,y)=0U',
        '__wfe()=',
        '__wfi()=',
        '__yield()=',
        '__vfp_status(x,y)=0'
    ];

    private static readonly armclangMacros: string[] = [
        '__alignof__(x)=',
        '__asm(x)=',
        '__asm__(x)=',
        '__forceinline=',
        '__restrict=',
        '__volatile__=',
        '__inline=',
        '__inline__=',
        '__declspec(x)=',
        '__attribute__(x)=',
        '__nonnull__(x)=',
        '__unaligned=',
        '__promise(x)=',
        '__irq=',
        '__swi=',
        '__weak=',
        '__register=',
        '__pure=',
        '__value_in_regs=',

        '__breakpoint(x)=',
        '__current_pc()=0U',
        '__current_sp()=0U',
        '__disable_fiq()=',
        '__disable_irq()=',
        '__enable_fiq()=',
        '__enable_irq()=',
        '__force_stores()=',
        '__memory_changed()=',
        '__schedule_barrier()=',
        '__semihost(x,y)=0',
        '__vfp_status(x,y)=0',

        '__builtin_arm_nop()=',
        '__builtin_arm_wfi()=',
        '__builtin_arm_wfe()=',
        '__builtin_arm_sev()=',
        '__builtin_arm_sevl()=',
        '__builtin_arm_yield()=',
        '__builtin_arm_isb(x)=',
        '__builtin_arm_dsb(x)=',
        '__builtin_arm_dmb(x)=',

        '__builtin_bswap32(x)=0U',
        '__builtin_bswap16(x)=0U',
        '__builtin_arm_rbit(x)=0U',

        '__builtin_clz(x)=0U',
        '__builtin_arm_ldrex(x)=0U',
        '__builtin_arm_strex(x,y)=0U',
        '__builtin_arm_clrex()=',
        '__builtin_arm_ssat(x,y)=0U',
        '__builtin_arm_usat(x,y)=0U',
        '__builtin_arm_ldaex(x)=0U',
        '__builtin_arm_stlex(x,y)=0U'
    ];

    private static armclangBuildinMacros: string[] | undefined;

    protected checkProject(): Error | undefined {
        return undefined;
    }

    protected getOutputFolder(target: any): string | undefined {
        try {
            return <string>target['TargetOption']['TargetCommonOption']['OutputDirectory'];
        } catch (error) {
            return undefined;
        }
    }

    private gnuParseRefLines(lines: string[]): string[] {

        const resultList: Set<string> = new Set();

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const _line = lines[lineIndex];

            const line = _line[_line.length - 1] === '\\' ? _line.substring(0, _line.length - 1) : _line; // remove char '\'
            const subLines = line.trim().split(/(?<![\\:]) /);

            if (lineIndex === 0) // first line
            {
                for (let i = 1; i < subLines.length; i++) // skip first sub line
                {
                    resultList.add(subLines[i].trim().replace(/\\ /g, " "));
                }
            }
            else  // other lines, first char is whitespace
            {
                subLines.forEach((item) => {
                    resultList.add(item.trim().replace(/\\ /g, " "));
                });
            }
        }

        return Array.from(resultList);
    }

    private ac5ParseRefLines(lines: string[], startIndex = 1): string[] {

        const resultList: Set<string> = new Set<string>();

        for (let i = startIndex; i < lines.length; i++) {
            const sepIndex = lines[i].indexOf(": ");
            if (sepIndex > 0) {
                const line: string = lines[i].substring(sepIndex + 1).trim();
                resultList.add(line);
            }
        }

        return Array.from(resultList);
    }

    protected parseRefLines(target: any, lines: string[]): string[] {
        if (target['uAC6'] === 1) { // ARMClang
            return this.gnuParseRefLines(lines);
        } else { // ARMCC
            return this.ac5ParseRefLines(lines);
        }
    }

    private static initArmclangMacros() {
        if (ArmTarget.armclangBuildinMacros === undefined) {
            // const armClangPath = dirname(dirname(ResourceManager.getInstance().getArmUV4Path()))
            //     + File.sep + 'ARM' + File.sep + 'ARMCLANG' + File.sep + 'bin' + File.sep + 'armclang.exe';
            const armClangPath = `${ResourceManager.getInstance().getKeilRootDir()}${File.sep}ARM${File.sep}ARMCLANG${File.sep}bin${File.sep}armclang.exe`;
            ArmTarget.armclangBuildinMacros = ArmTarget.getArmClangMacroList(armClangPath);
        }
    }

    protected getSysDefines(target: any): string[] {
        if (target['uAC6'] === 1) { // ARMClang
            return ArmTarget.armclangMacros.concat(ArmTarget.armclangBuildinMacros || []);
        } else { // ARMCC
            return ArmTarget.armccMacros;
        }
    }

    private static getArmClangMacroList(armClangPath: string): string[] {
        try {
            const cmdLine = CmdLineHandler.quoteString(armClangPath, '"')
                + ' ' + ['--target=arm-arm-none-eabi', '-E', '-dM', '-', '<nul'].join(' ');

            const lines = execSync(cmdLine).toString().split(/\r\n|\n/);
            const resList: string[] = [];
            const mHandler = new MacroHandler();

            lines.filter((line) => { return line.trim() !== ''; })
                .forEach((line) => {
                    const value = mHandler.toExpression(line);
                    if (value) {
                        resList.push(value);
                    }
                });

            return resList;
        } catch (error) {
            return ['__GNUC__=4', '__GNUC_MINOR__=2', '__GNUC_PATCHLEVEL__=1'];
        }
    }

    protected getSystemIncludes(target: any): string[] | undefined {
        const keilRootDir = new File(ResourceManager.getInstance().getKeilRootDir());
        if (keilRootDir.isDir()) {
            const toolName = target['uAC6'] === 1 ? 'ARMCLANG' : 'ARMCC';
            const incDir = new File(`${keilRootDir.path}${File.sep}ARM${File.sep}${toolName}${File.sep}include`);
            if (incDir.isDir()) {
                return [incDir.path].concat(
                    incDir.getList(File.emptyFilter).map((dir) => { return dir.path; }));
            }
            return [incDir.path];
        }
        return undefined;
    }

    protected getComplieOptionsIncludes(target: any): string[] | undefined {
        // let incPaths:string[] = new Array<string>();
        // const lstDir  = new File(this.lstABSPath);
        // if(lstDir.isDir())
        // {
        //     const files= lstDir.getList();
        //     files.forEach((file)=>{
        //         if(file.suffix === ".lst"){
        //             const content = readFileSync(file.path, );
        //             const reg = new RegExp(/(?<=Command Line.*-I)[^ ]*(?=.*ARM Macro Assembler)/g);
        //             reg.flags;
        //             let resultstr = content.toString();
        //             resultstr = resultstr.replace(/(\r\n)*/g, "");
                    
        //             const results = resultstr.match(reg);
        //             // const s = [...results];
        //             results?.forEach((result)=>{
        //                 incPaths.push(result);
        //             });
        //         }
        //     }
        //     );
        //     if(incPaths.length>0)
        //     {
        //         return incPaths;
        //     }
        // };
        const optionsStr = this.getComplieOptions(target);
        let incDirs:string[]=[];
        if(optionsStr)
        {
            // optionsStr.replace(/(\r\n)*/,' ');
            let matchs = optionsStr.match(/(?<=-I)\s*([^\s]+)/g);
            matchs?.forEach((res)=>{
                incDirs?.push(res.trim());
            });
        }
        if(incDirs.length>0)
        {
            return incDirs;
        }
        return undefined;
    }

    protected getComplieOptionsDefines(target: any): string[] | undefined{
        let defFromCOptions:string[]=[];
        const optionsStr = this.getComplieOptions(target);
        if(optionsStr){
            let matchs = optionsStr.match(/(?<=-D)\S+(?=\s)/g);
            matchs?.forEach((res)=>{
                defFromCOptions.push(res.replace(/"/g, ""));
            });
            if(defFromCOptions.length>0){
                return defFromCOptions;
            }
        }
        return undefined;
    }

    protected getIncString(target: any): string {
        const dat = target['TargetOption']['TargetArmAds']['Cads'];
        return dat['VariousControls']['IncludePath'];
    }

    protected getDefineString(target: any): string {
        const dat = target['TargetOption']['TargetArmAds']['Cads'];
        return dat['VariousControls']['Define'];
    }

    protected getGroups(target: any): any[] {
        return target['Groups']['Group'] || [];
    }

    protected getProblemMatcher(): string[] {
        return ['$armcc', '$gcc'];
    }
    /*
        protected getBuildCommand(): string[] {
            return [
                '--uv4Path', ResourceManager.getInstance().getArmUV4Path(),
                '--prjPath', this.project.uvprjFile.path,
                '--targetName', this.targetName,
                '-c', '${uv4Path} -b ${prjPath} -j0 -t ${targetName}'
            ];
        }
    
        protected getRebuildCommand(): string[] {
            return [
                '--uv4Path', ResourceManager.getInstance().getArmUV4Path(),
                '--prjPath', this.project.uvprjFile.path,
                '--targetName', this.targetName,
                '-c', '${uv4Path} -r ${prjPath} -j0 -t ${targetName}'
            ];
        }
    
        protected getDownloadCommand(): string[] {
            return [
                '--uv4Path', ResourceManager.getInstance().getArmUV4Path(),
                '--prjPath', this.project.uvprjFile.path,
                '--targetName', this.targetName,
                '-c', '${uv4Path} -f ${prjPath} -j0 -t ${targetName}'
            ];
        }*/
}

//================================================

class ProjectExplorer implements vscode.TreeDataProvider<IView> {

    private itemClickCommand = 'Item.Click';

    onDidChangeTreeData: vscode.Event<IView>;
    private viewEvent: vscode.EventEmitter<IView>;

    private prjList: Map<string, KeilProject>;
    private currentActiveProject: KeilProject | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.prjList = new Map();
        this.viewEvent = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.viewEvent.event;
        context.subscriptions.push(vscode.window.registerTreeDataProvider('project', this));
        context.subscriptions.push(vscode.commands.registerCommand(this.itemClickCommand, (item) => this.onItemClick(item)));
    }

    async loadWorkspace() {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const wsFilePath: string = vscode.workspace.workspaceFile && /^file:/.test(vscode.workspace.workspaceFile.toString()) ?
                dirname(vscode.workspace.workspaceFile.fsPath) : vscode.workspace.workspaceFolders[0].uri.fsPath;
            const workspace = new File(wsFilePath);
            if (workspace.isDir()) {
                const excludeList = ResourceManager.getInstance().getProjectExcludeList();

                let uvList = workspace.getList([/\.uvproj[x]?$/i], File.emptyFilter);
                // uvList.concat() //本地文件列表
                ResourceManager.getInstance().getProjectFileLocationList().forEach(
                    str => {
                        uvList = uvList.concat(workspace.path2File(str, [/\.uvproj[x]?$/i], File.emptyFilter));
                    }
                );
                uvList.filter((file) => { return !excludeList.includes(file.name); });
                for (const uvFile of uvList) {
                    try {
                        // console.log('prj uvFile start', uvFile);
                        await this.openProject(uvFile.path);
                    } catch (error) {
                        console.log(`Error: open project ${error}`);
                        vscode.window.showErrorMessage(`open project: '${uvFile.name}' failed !, msg: ${(<Error>error).message}`);
                    }
                }
            }
        }
    }

    async openProject(path: string): Promise<KeilProject | undefined> {
        const nPrj = new KeilProject(new File(path));
        if (!this.prjList.has(nPrj.prjID)) {

            await nPrj.load();
            nPrj.on('dataChanged', () => this.updateView());
            this.prjList.set(nPrj.prjID, nPrj);

            if (this.currentActiveProject === undefined) {
                this.currentActiveProject = nPrj;
                this.currentActiveProject.active();
            }

            this.updateView();

            return nPrj;
        }
    }

    async closeProject(pID: string) {
        const prj = this.prjList.get(pID);
        if (prj) {
            prj.deactive();
            prj.close();
            this.prjList.delete(pID);
            this.updateView();
        }
    }

    async activeProject(view: IView) {
        const project = this.prjList.get(view.prjID);
        if (project) {
            this.currentActiveProject?.deactive();
            this.currentActiveProject = project;
            this.currentActiveProject?.active();
            this.updateView(view);
        }
    }

    async switchTargetByProject(view: IView) {
        const prj = this.prjList.get(view.prjID);
        if (prj) {
            const tList = prj.getTargets();
            const targetName = await vscode.window.showQuickPick(tList.map((ele) => { return ele.targetName; }), {
                canPickMany: false,
                placeHolder: 'please select a target name for keil project'
            });
            if (targetName) {
                prj.setActiveTarget(targetName);
            }
        }
    }

    async statusBarSwitchTargetByProject() {
        if (this.currentActiveProject) {
            const tList = this.currentActiveProject?.getTargets();
            const targetName = await vscode.window.showQuickPick(tList.map((ele) => { return ele.targetName; }), {
                canPickMany: false,
                placeHolder: 'please select a target name for keil project'
            });
            if (targetName) {
                this.currentActiveProject?.setActiveTarget(targetName);
            }
        }
    }

    getProjectList():KeilProject[]|undefined
    {
        let prjs:KeilProject[] = [];
        this.prjList.forEach((prj)=>{
            prjs.push(prj);
        });
        if(prjs.length>0){
            return prjs;
        }
        return undefined;
    }

    getTarget(view?: IView): Target | undefined {
        if (view) {
            const prj = this.prjList.get(view.prjID);
            if (prj) {
                const targets = prj.getTargets();
                const index = targets.findIndex((target) => {
                    return target.targetName === view.label;
                });
                if (index !== -1) {
                    return targets[index];
                }
            }
        } else { // get active target
            if (this.currentActiveProject) {
                return this.currentActiveProject.getActiveTarget();
            } else {
                vscode.window.showWarningMessage('Not found any active project !');
            }
        }
    }

    updateView(v?: IView) {
        updateStatusBarItem(this.currentActiveProject?.activeTargetName);
        this.viewEvent.fire(v!!);
    }

    //----------------------------------

    itemClickInfo: any = undefined;

    private async onItemClick(item: IView) {
        switch (item.contextVal) {
            case 'Source':
                {
                    const source = <Source>item;
                    const file = new File(normalize(source.file.path));

                    if (file.isFile()) { // file exist, open it

                        let isPreview = true;

                        if (this.itemClickInfo &&
                            this.itemClickInfo.name === file.path &&
                            this.itemClickInfo.time + 260 > Date.now()) {
                            isPreview = false;
                        }

                        // reset prev click info
                        this.itemClickInfo = {
                            name: file.path,
                            time: Date.now()
                        };

                        vscode.window.showTextDocument(vscode.Uri.parse(file.toUri()), { preview: isPreview });

                    } else {
                        vscode.window.showWarningMessage(`Not found file: ${source.file.path}`);
                    }
                }
                break;
            default:
                break;
        }
    }

    getTreeItem(element: IView): vscode.TreeItem | Thenable<vscode.TreeItem> {

        const res = new vscode.TreeItem(element.label);

        res.contextValue = element.contextVal;
        res.tooltip = element.tooltip;
        res.collapsibleState = element.getChildViews() === undefined ?
            vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed;

        if (element instanceof Source) {
            res.command = {
                title: element.label,
                command: this.itemClickCommand,
                arguments: [element]
            };
        }

        if (element.icons) {
            res.iconPath = {
                light: ResourceManager.getInstance().getIconByName(element.icons.light),
                dark: ResourceManager.getInstance().getIconByName(element.icons.dark)
            };
        }
        return res;
    }

    getChildren(element?: IView | undefined): vscode.ProviderResult<IView[]> {
        if (element === undefined) {
            return Array.from(this.prjList.values());
        } else {
            return element.getChildViews();
        }
    }
}

