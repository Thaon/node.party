import * as log from "./log.js";
import { Room } from "./Room.js";
import { Record } from "./Record.js";

const version = "0.1";

class NodeParty {
  constructor() {
    log.styled("font-weight: bold", `node.party v${version}`);
  }

  auto = false; // sessionStorage.getItem("auto") === "true";
  room = null;

  connect = async (host, appName, roomName = "_main", cb = null) => {
    if (this.room !== null) {
      log.warn("You should call connect() only one time");
      return;
    }
    const load = async () => {
      this.room = new Room(host, appName, roomName);
      await this.room.whenConnected;
      // WHAT DO?
      // window.addEventListener("beforeunload", () => {
      //   this.room?.disconnect();
      // });

      // Auto reloading
      // When iterating, it is usually best to have all connected clients reload
      // when the code changes. This can be set up on local dev easily, but
      // the p5 web editor doesn't support this.
      // The auto setting, which can be manually enabled from the info panel tells p5 party to automatically reload all other guests in the room when the "auto" guest is reloaded.
      // Reloading happens immediately after the auto guest connects, making the auto guest the host before setup() is called.

      // const auto = sessionStorage.getItem("auto") === "true";
      log.log("Auto:", this.auto);
      if (this.auto) {
        log.log("Auto enabled. Reloading others...");
        this.room.emit("nodePartyEvent", {
          action: "disconnect-reload",
          sender: this.room.info().guestName,
        });
        // await become host
        while (!this.room.isHost()) {
          log.log("Waiting...");
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      this.room.subscribe("nodePartyEvent", async (data) => {
        const handleAction = async () => {
          if (!this.room) return;

          // reload-others
          if (
            data.action === "reload-others" &&
            data.sender != this.room.info().guestName
          ) {
            log.log("Recieved reload-others nodePartyEvent. Reloading...");
            // window.location.reload(); WHAT DO?
          }

          // disconnect-others
          if (
            data.action === "disconnect-others" &&
            data.sender != this.room.info().guestName
          ) {
            log.log(
              "Recieved disconnect-others nodePartyEvent. Disconnecting..."
            );
            this.room.disconnect();
          }

          // disconnect-reload;
          if (
            data.action === "disconnect-reload" &&
            data.sender != this.room.info().guestName
          ) {
            if (this.auto) {
              log.alert(
                "Recieved disconnect-reload nodePartyEvent, but auto is set. Disabling auto..."
              );
              // sessionStorage.setItem("auto", "false");
              this.auto = false;
            }
            log.log(
              "Recieved disconnect-reload nodePartyEvent. Disconnecting..."
            );
            this.room.disconnect();
            await new Promise((r) => setTimeout(r, 500));
            log.log("Reloading...");
            // window.location.reload(); WHAT DO?
          }
        };
        await handleAction();
      });

      log.log("connect done!");
      // this._decrementPreload();
      cb?.();
    };
    await load();
  };

  loadShared = async (name, initObject, cb = null) => {
    if (this.room === null) {
      log.error("loadShared() called before connect()");
      return undefined;
    }
    const record = this.room.getRecord(name);

    const load = async () => {
      await this.room?.whenConnected; // room null checked above

      const overwrite = this.room?.isHost() === true;
      await record.load(initObject, overwrite);
      log.log(`loadShared "${name}" done!`);
      cb?.(record.shared);
    };

    await load();

    return record.shared;
  };

  loadMine = async (initObject = {}, cb = null) => {
    if (this.room === null) {
      log.error("loadMine() called before connect()");
      return undefined;
    }

    const record = this.room.myGuestRecord;

    const load = async () => {
      await this.room?.whenConnected; // room null checked above
      await record.whenLoaded;
      await record.initData(initObject);
      log.log(`loadMine done!`);
      cb?.(record.shared);
      // this._decrementPreload();
    };

    await load();

    return record.shared;
  };

  loadOthers = () => {
    if (this.room === null) {
      log.error("loadOthers() called before connect()");
      return undefined;
    }
    return this.room.guestShareds;
  };

  isHost = () => {
    if (this.room === null) {
      log.error("isHost() called before connect()");
      return false;
    }
    return this.room.isHost();
  };

  setShared = (shared, object) => {
    if (!Record.recordForShared(shared)) {
      log.warn(
        "setShared() doesn't recognize the provided shared object.",
        shared
      );
      return;
    }
    Record.recordForShared(shared)?.setData(object);
  };

  watchShared = (shared, a, b, c) => {
    if (!Record.recordForShared(shared)) {
      log.warn(
        "watchShared() doesn't recognize the provided shared object.",
        shared
      );
      return;
    }
    Record.recordForShared(shared)?.watchShared(a, b, c);
  };

  // ! sub
  sub = (event, cb) => {
    if (this.room === null) {
      log.error("sub() called before connect()");
      return;
    }
    this.room.subscribe(event, cb);
  };

  // ! unsub
  unsub = (event, cb = null) => {
    if (this.room === null) {
      log.error("unsub() called before connect()");
      return;
    }
    this.room.unsubscribe(event, cb);
  };

  // ! emit
  emit = (event, data) => {
    if (this.room === null) {
      log.error("emit() called before connect()");
      return;
    }
    this.room.emit(event, data);
  };
}

export default NodeParty;
