// Test for the node.party module

import NodeParty from "node.party";

const test = async () => {
  const party = new NodeParty();

  // connect to the server
  await party.connect(
    "wss://demoserver.p5party.org",
    "NodePartyTest",
    "NodePartyTest",
    () => {
      console.log("Connected");
    }
  );

  let shared = await party.loadShared("test1", { x: 1, y: 2 });
  console.log("shared", shared);
  shared.x = 3;
};

test();
