import { DeepstreamClient } from "@deepstream/client";
import * as log from "./log.js";
import { isJSONValue, isEmpty } from "./validate.js";
import { Record } from "./Record.js";

export class Room {
  #ds;
  #appName;
  #roomName;
  #roomId; // e.g. "app-room"
  #guestName; // e.g. "app-room/client-uid"
  #guestRecords;
  #guestShareds; // all guest shareds in this room
  #publishedGuestShareds; // just the non-empty ones
  #myGuestRecord; // record for this guest's shared object
  #whenConnected;

  #guestNames; // names of guests in the room
  #hostName; // name of designated host

  constructor(host, appName, roomName, onGuestsChange, onOthersUpdate) {
    this.#ds = new DeepstreamClient(host);
    this.#appName = appName;
    this.#roomName = roomName;
    this.#roomId = `${appName}-${roomName}`;
    this.#guestName = `${this.#roomId}/${this.#ds.getUid()}`;
    this.#guestRecords = new Map();
    this.#guestShareds = [];
    this.#publishedGuestShareds = [];
    this.#myGuestRecord = new Record(this.#ds, this.#guestName);
    this.#guestNames = [];
    this.#hostName = undefined;
    this.#whenConnected = this.#connect();
    this.onGuestsChange = onGuestsChange;
    this.onOthersUpdate = onOthersUpdate;
  }

  #connect() {
    const innerConnect = async () => {
      // subscribe to errors
      /* istanbul ignore next */ // error reporting
      this.#ds.on("error", (error, event, topic) =>
        log.error("ds error", error, event, topic)
      );

      // subscribe to ANY/ALL clients connect/disconnect on SERVER
      // (not limited to app / room)
      this.#ds.presence.subscribe(this.#onPresence.bind(this));

      // log in to deepstream server
      await this.#ds.login({ username: this.#guestName });

      // load my guest record
      void this.#myGuestRecord.load();

      // get room list and determine host
      await this.#updateGuestNames();

      // get the guest records and update guestShareds
      this.#updateGuestShareds();
    };
    return innerConnect();
  }

  _isConnected() {
    return this.#ds.getConnectionState() === "OPEN";
  }

  get whenConnected() {
    return this.#whenConnected;
  }

  disconnect() {
    if (!this._isConnected()) return;
    this.#ds.close();
  }

  info() {
    return {
      appName: this.#appName,
      roomName: this.#roomName,
      guestNames: this.#guestNames,
      guestName: this.#guestName,
      isConnected: this._isConnected(),
      isHost: this.isHost(),
    };
  }
  getRecord(name) {
    const r = new Record(this.#ds, `${this.#roomId}/${name}`);
    return r;
  }

  subscribe(event, cb) {
    this.#ds.event.subscribe(`${this.#roomId}/${event}`, cb);
  }

  unsubscribe(event, cb = null) {
    // cb `` because cb CAN BE undefined
    this.#ds.event.unsubscribe(`${this.#roomId}/${event}`, cb);
  }

  emit(event, data = null) {
    if (data === undefined || isJSONValue(data, "emit-data")) {
      // data `as JSONValue` because data CAN BE undefined
      this.#ds.event.emit(`${this.#roomId}/${event}`, data);
    }
  }

  // at any given time any occupied room has exactly one host
  get hostName() {
    return this.#hostName;
  }

  // sorted list of connected guests in this room
  // semi-private for test suite
  get _guestNames() {
    // return copy so that it can't be modified
    return [...this.#guestNames];
  }

  get myGuestRecord() {
    return this.#myGuestRecord;
  }

  get guestShareds() {
    // return read only proxy of array
    // caller can still modify properties of the items
    return new Proxy(this.#publishedGuestShareds, {
      set() {
        log.error("The guestShared array is read-only.");
        // eat the value
        return true;
      },
    });
  }

  get guests() {
    return this.#guestNames;
  }

  isHost() {
    return this.#hostName === this.#guestName;
  }

  async #updateGuestNames() {
    const everyone = await this.#ds.presence.getAll();

    this.#guestNames = everyone
      .filter((guestName) => guestName.startsWith(`${this.#roomId}/`))
      .concat(this.#guestName)
      .sort();
    this.#hostName = this.#guestNames[0];
  }

  #onPresence(username, isLoggedIn) {
    if (!username.startsWith(`${this.#roomId}/`)) return; // not in this room
    if (isLoggedIn) {
      // add to #guestNames
      this.#guestNames.push(username);
      this.#guestNames.sort();
    } else {
      // remove from #guestNames
      this.#guestNames = this.#guestNames.filter(
        (guestName) => guestName !== username
      );
    }

    // update host
    this.#hostName = this.#guestNames[0];

    // update guest shareds
    this.#updateGuestShareds();

    // notify caller
    if (this.onGuestsChange) this.onGuestsChange(this.#guestNames);
  }

  #updateGuestShareds() {
    const updatePublishedGuestShareds = () => {
      this.#publishedGuestShareds.length = 0;
      const nonemptyShareds = this.#guestShareds.filter((s) => !isEmpty(s));
      this.#publishedGuestShareds.push(...nonemptyShareds);
      if (this.onOthersUpdate)
        this.onOthersUpdate([
          ...this.#publishedGuestShareds.filter(
            (s) => s !== this.#myGuestRecord.shared
          ),
        ]);
    };

    // add any missing records to guestRecords, start loading them
    for (const name of this.#guestNames) {
      if (this.#guestRecords.has(name)) continue;
      if (name === this.#guestName) {
        // add my guest record
        this.#guestRecords.set(name, this.#myGuestRecord);
        // republish when record changes
        void this.#myGuestRecord.whenLoaded.then(() => {
          this.#myGuestRecord.watchShared(
            updatePublishedGuestShareds.bind(this),
            true
          );
        });
      } else {
        // create record for remote guest and add it
        const r = new Record(this.#ds, name);
        this.#guestRecords.set(name, r);
        // republish when record changes
        void r.load().then(() => {
          r.watchShared(updatePublishedGuestShareds.bind(this), true);
        });
      }
    }

    // update shareds in guestShareds
    this.#guestShareds.length = 0; // empty it
    for (const name of this.#guestNames) {
      if (name === this.#guestName) {
        // add `my` guest record
        this.#guestShareds.push(this.#myGuestRecord.shared);
      } else {
        // add remote guest record
        const r = this.#guestRecords.get(name);
        if (r) this.#guestShareds.push(r.shared);
      }
    }

    updatePublishedGuestShareds();
  }
}
