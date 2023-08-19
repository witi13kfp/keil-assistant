import { File } from "./File";
import * as fs from 'fs';
import * as events from "events";

export class FileWatcher {

    readonly file: File;
    private watcher?: fs.FSWatcher;
    private selfWatcher?: fs.FSWatcher;
    private isDir: boolean;
    private recursive: boolean;
    private _event: events.EventEmitter;

    onRename?: (file: File) => void;
    onChanged?: (file: File) => void;

    constructor(_file: File, _recursive = false) {
        this.file = _file;
        this.recursive = _recursive;
        this.isDir = this.file.isDir();
        this._event = new events.EventEmitter();
    }

    on(event: 'error', listener: (err: Error) => void): this;
    on(event: any, listener: (arg?: any) => void): this {
        this._event.on(event, listener);
        return this;
    }

    watch(): this {

        if (this.isDir && this.selfWatcher === undefined) {
            this.selfWatcher = fs.watch(this.file.dir, { recursive: false }, (event, fname) => {
                if (event === 'rename' && fname === this.file.name && this.onRename) {
                    this.onRename(this.file);
                }
            });
            this.selfWatcher.on('error', (err) => {
                this._event.emit('error', err);
            });
        }

        if (this.watcher === undefined) {
            this.watcher = fs.watch(this.file.path, { recursive: this.recursive }, (event, filename) => {
                switch (event) {
                    case 'rename':
                        if (this.onRename) {
                            this.onRename(this.isDir ? File.fromArray([this.file.path, filename||""]) : this.file);
                        }
                        break;
                    case 'change':
                        if (this.onChanged) {
                            this.onChanged(this.isDir ? File.fromArray([this.file.path, filename||""]) : this.file);
                        }
                        break;
                }
            });
            this.watcher.on('error', (err) => {
                this._event.emit('error', err);
            });
        }
        return this;
    }

    close() {

        if (this.selfWatcher) {
            this.selfWatcher.close();
            this.selfWatcher = undefined;
        }

        if (this.watcher) {
            this.watcher.close();
            this.watcher = undefined;
        }
    }
}
