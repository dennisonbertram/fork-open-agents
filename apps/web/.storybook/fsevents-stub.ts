const noop = () => {};

const handler = {
  get(_target: unknown, prop: string) {
    if (prop === "then") {
      return undefined;
    }
    return noop;
  },
};

const stub = new Proxy(noop, handler);

export default stub;
export const watch = stub;
export const getWatchers = stub;
export const getInfo = stub;
export const Info = { version: "0.0.0-stub" };
export const constants = { WATCHCOMPACT: 0 };
