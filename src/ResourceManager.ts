import * as vscode from 'vscode';
import { File } from './node_utility/File';

let _instance: ResourceManager | undefined;

const dirList: string[] = [
    File.sep + 'bin',
    File.sep + 'res',
    File.sep + 'res' + File.sep + 'icons'
];

export class ResourceManager {

    private extensionDir: File;
    private dirMap: Map<string, File>;
    private iconMap: Map<string, string>;

    private constructor(context: vscode.ExtensionContext) {
        this.extensionDir = new File(context.extensionPath);
        this.dirMap = new Map();
        this.iconMap = new Map();
        this.init();
    }

    static getInstance(context?: vscode.ExtensionContext): ResourceManager {
        if (_instance === undefined) {
            if (context) {
                _instance = new ResourceManager(context);
            } else {
                throw Error('context can\'t be undefined');
            }
        }
        return _instance;
    }

    private init() {
        // init dirs
        for (const path of dirList) {
            const f = new File(this.extensionDir.path + path);
            if (f.isDir()) {
                this.dirMap.set(f.noSuffixName, f);
            }
        }

        // init icons
        const iconDir = this.dirMap.get('icons');
        if (iconDir) {
            for (const icon of iconDir.getList([/\.svg$/i], File.emptyFilter)) {
                this.iconMap.set(icon.noSuffixName, icon.path);
            }
        }
    }

    private getAppConfig(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('KeilAssistant');
    }

    getBuilderExe(): string {
        return this.dirMap.get('bin')?.path + File.sep + 'Uv4Caller.exe';
    }

    /*getC51UV4Path(): string {
        // return this.getAppConfig().get<string>('C51.Uv4Path') || 'null';
        return this.getKeilUV4Path();
    }

    getC251UV4Path(): string {
        // return this.getAppConfig().get<string>('C251.Uv4Path') || 'null';
        return this.getKeilUV4Path();
    }

    getArmUV4Path(): string {
        // return this.getAppConfig().get<string>('MDK.Uv4Path') || 'null';
        return this.getKeilUV4Path();
    }*/

    getKeilUV4Path(): string {
        return `${this.getKeilRootDir()}${File.sep}UV4${File.sep}UV4.exe`;
    }

    getKeilRootDir(): string {
        return this.getAppConfig().get<string>('Keil.InstallationDirectory') || 'C:\\Keil_v5';
    }

    getKeilPackDir(): string {
        return this.getAppConfig().get<string>('Keil.KeilPackPath') || 'C:\\Keil_pack';
    }

    getProjectExcludeList(): string[] {
        return this.getAppConfig().get<string[]>('Project.ExcludeList') || [];
    }

    // 附加本地文件
    getProjectFileLocationList(): string[] {
        return this.getAppConfig().get<string[]>('Project.FileLocationList') || [];
    }

    getIconByName(name: string): string {
        return this.iconMap.get(name)!!;
    }
}