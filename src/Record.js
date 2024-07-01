import onChange from "on-change";

import { CONNECTION_STATE } from "@deepstream/client/dist/src/constants.js";

import * as log from "./log.js";

import { isJSONValue, isJSONObject, isEmpty } from "./validate.js";

import { patchInPlace } from "./patch.js";

// type SharedObject = JSONObject;

const sharedRecordLookup = new WeakMap();

export class Record {
  #ds;
  #name;
  #dsRecord;
  #shared;
  #watchedShared;
  #whenLoaded;

  constructor(ds, name) {
    this.#ds = ds;
    this.#name = name;
    this.#dsRecord = null;
    this.#shared = {};
    this.#watchedShared = onChange(
      this.#shared,
      this.#onClientChangeData.bind(this),
      {
        onValidate: this.#onClientValidateData.bind(this),
      }
    );
    this.#whenLoaded = null;

    sharedRecordLookup.set(this.#shared, this);
  }

  async load(initObject, overwrite = false) {
    if (this.#whenLoaded) {
      log.warn("Record.load() called twice!", this.#name);
      return this.#whenLoaded;
    }

    if (this.#ds.getConnectionState() !== CONNECTION_STATE.OPEN) {
      // "OPEN"
      log.error("Record.load() called before room is connected.", this.#name);
      return;
    }

    const innerLoad = async () => {
      this.#dsRecord = this.#ds.record.getRecord(this.#name);
      this.#dsRecord.subscribe(this.#onServerChangeData.bind(this), true);
      await this.#dsRecord.whenReady();
      if (!initObject) return;
      await this.initData(initObject, overwrite);
    };

    this.#whenLoaded = innerLoad();
    return this.#whenLoaded;
  }

  get whenLoaded() {
    if (this.#whenLoaded === null) {
      log.error("Record.whenLoaded called before load().", this.#name);
      return Promise.reject(
        new Error("Record.whenLoaded called before load().")
      );
    }
    return this.#whenLoaded;
  }

  /**
   * sets initial data on the record only if the record is empty
   *
   * @param data initial data to set on the record
   */

  async initData(data, overwrite = false) {
    if (!this.#dsRecord?.isReady) {
      log.error("Record.initData() called before record ready.", this.#name);
      return;
    }

    // if (!data) return;
    if (!overwrite && !isEmpty(this.#dsRecord.get())) return; // don't overwrite existing data
    if (!isJSONObject(data, "init-data")) return; // don't try to write bad data

    // todo: allow but warn non-owner writes
    await this.#dsRecord.setWithAck(data);
  }

  setData(data) {
    if (!this.#dsRecord?.isReady) {
      // prettier-ignore
      log.error(
        `Record.setData() called before record ready. ${
          this.#name
        }\n Ignored: ${JSON.stringify(data)}`
      );
      return;
    }
    if (!isJSONObject(data, "set-data")) return; // don't try to write bad data

    // todo: allow but warn non-owner writes
    this.#dsRecord.set(data);
  }

  watchShared(path, cb = null, triggerNow = false) {
    if (!this.#dsRecord?.isReady) {
      log.warn(`watchShared() called on '${this.#name}' before ready.`);
      return;
    }

    this.#dsRecord.subscribe(path, cb, triggerNow);
  }

  get shared() {
    return this.#watchedShared;
  }

  get name() {
    return this.#name;
  }

  async delete() {
    if (!this.#dsRecord?.isReady) {
      log.error(`delete() called on ${this.#name} before ready.`);
      return;
    }

    return new Promise((resolve) => {
      this.#dsRecord?.once("delete", resolve);
      void this.#dsRecord?.delete();
    });
  }

  async _set(path, value) {
    // value `` because all JSONValues ARE supported
    await this.#dsRecord?.setWithAck(path, value);
  }

  _get(key) {
    return this.#dsRecord?.get(key);
  }

  #onClientValidateData(path, newValue, oldValue) {
    return isJSONValue(newValue, `${this.#name}/${path}`);
  }

  #onClientChangeData(path, newValue, oldValue) {
    if (!this.#dsRecord?.isReady) {
      // prettier-ignore
      log.warn(
        `Shared object written to before ready. ${
          this.#name
        }\n Ignored: ${path} = ${JSON.stringify(newValue)}`
      );
      return;
    }
    // todo: warn and allow non-owner writes

    // `as JSONValue` because newValue validated in onClientValidateData
    void this._set(path, newValue);
  }

  #onServerChangeData(data) {
    /* istanbul ignore next */ // the server should never be sending this
    if (!isJSONObject(data, "server-data")) {
      log.error(`Incoming server data not valid.`);
    }
    // don't replace #shared itself as #watchedShared has a reference to it
    // instead patch it to match the incoming data
    patchInPlace(this.#shared, data, "shared");
  }

  static recordForShared(watchedShared) {
    const shared = onChange.target(watchedShared);

    if (!sharedRecordLookup.has(shared)) {
      log.error(`No record found for shared object.`);
      return undefined;
    }
    return sharedRecordLookup.get(shared);
  }
}
