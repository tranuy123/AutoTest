// Shim vitest toi thieu chay tren node:test.
//
// Ly do ton tai: tren Muse VM, vitest CLI khong chay duoc vi Vite ghi file
// tam cau hinh va bi tang sandbox chan ghi (EPERM) - xem
// spikes/stream/BAO-CAO-SPIKE.md muc 5. Shim nay cho phep chay DUNG bo test
// .test.ts cua du an bang Node test runner de nghiem thu tren VM; tren may
// that, "pnpm test" (vitest that) van la duong chinh.
//
// Chi ho tro API ma bo test cua du an dung: describe/it/test (+skip/skipIf),
// beforeAll/afterAll/beforeEach/afterEach, expect voi cac matcher pho bien.
import assert from "node:assert/strict";
import {
  describe as ndescribe,
  it as nit,
  before,
  after,
  beforeEach,
  afterEach,
} from "node:test";

function withVariants(base) {
  const fn = (name, fnOrOptions, maybeFn) => base(name, fnOrOptions, maybeFn);
  fn.skip = (name, fnBody) => base(name, { skip: true }, fnBody ?? (() => {}));
  fn.skipIf = (cond) => (cond ? fn.skip : fn);
  fn.only = fn;
  return fn;
}

export const describe = withVariants(ndescribe);
export const it = withVariants(nit);
export const test = it;
export const beforeAll = before;
export const afterAll = after;
export { beforeEach, afterEach };

function fmt(v) {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function deepEq(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

/** Khop mot phan (subset) nhu expect().toMatchObject cua vitest. */
function matchObject(actual, expected) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length < expected.length) return false;
    return expected.every((exp, i) => matchObject(actual[i], exp));
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object") return false;
    return Object.entries(expected).every(([k, v]) => matchObject(actual[k], v));
  }
  return deepEq(actual, expected) || actual === expected;
}

function makeExpect(actual, negated = false) {
  const check = (pass, msg) => {
    assert.ok(negated ? !pass : pass, msg);
  };
  const api = {
    toBe(exp) {
      check(Object.is(actual, exp), `expected ${fmt(actual)} toBe ${fmt(exp)}`);
    },
    toEqual(exp) {
      check(deepEq(actual, exp), `expected ${fmt(actual)} toEqual ${fmt(exp)}`);
    },
    toStrictEqual(exp) {
      api.toEqual(exp);
    },
    toContain(exp) {
      const pass =
        typeof actual === "string"
          ? actual.includes(exp)
          : Array.isArray(actual)
            ? actual.some((x) => x === exp || deepEq(x, exp))
            : false;
      check(pass, `expected ${fmt(actual)} toContain ${fmt(exp)}`);
    },
    toHaveLength(n) {
      check(actual?.length === n, `expected length ${actual?.length} toBe ${n}`);
    },
    toBeLessThanOrEqual(exp) {
      check(actual <= exp, `expected ${fmt(actual)} toBeLessThanOrEqual ${fmt(exp)}`);
    },
    toBeGreaterThanOrEqual(exp) {
      check(actual >= exp, `expected ${fmt(actual)} toBeGreaterThanOrEqual ${fmt(exp)}`);
    },
    toBeLessThan(exp) {
      check(actual < exp, `expected ${fmt(actual)} toBeLessThan ${fmt(exp)}`);
    },
    toBeGreaterThan(exp) {
      check(actual > exp, `expected ${fmt(actual)} toBeGreaterThan ${fmt(exp)}`);
    },
    toThrow(exp) {
      assert.equal(typeof actual, "function", "toThrow can mot ham");
      let threw = null;
      try {
        actual();
      } catch (e) {
        threw = e;
      }
      let pass = threw !== null;
      if (pass && exp !== undefined) {
        const msg = threw instanceof Error ? threw.message : String(threw);
        if (typeof exp === "string") pass = msg.includes(exp);
        else if (exp instanceof RegExp) pass = exp.test(msg);
        else if (typeof exp === "function") pass = threw instanceof exp;
      }
      check(pass, `expected function toThrow ${exp ?? ""}, threw: ${threw}`);
    },
    toMatch(exp) {
      const s = String(actual);
      const pass = exp instanceof RegExp ? exp.test(s) : s.includes(String(exp));
      check(pass, `expected ${fmt(s)} toMatch ${exp}`);
    },
    toBeNull() {
      check(actual === null, `expected ${fmt(actual)} toBeNull`);
    },
    toBeUndefined() {
      check(actual === undefined, `expected ${fmt(actual)} toBeUndefined`);
    },
    toBeDefined() {
      check(actual !== undefined, "expected value toBeDefined");
    },
    toBeTruthy() {
      check(Boolean(actual), `expected ${fmt(actual)} toBeTruthy`);
    },
    toBeFalsy() {
      check(!actual, `expected ${fmt(actual)} toBeFalsy`);
    },
    toBeGreaterThan(n) {
      check(actual > n, `expected ${actual} > ${n}`);
    },
    toBeGreaterThanOrEqual(n) {
      check(actual >= n, `expected ${actual} >= ${n}`);
    },
    toBeLessThan(n) {
      check(actual < n, `expected ${actual} < ${n}`);
    },
    toBeInstanceOf(cls) {
      check(actual instanceof cls, `expected instance of ${cls?.name}`);
    },
    toMatchObject(exp) {
      check(matchObject(actual, exp), `expected ${fmt(actual)} toMatchObject ${fmt(exp)}`);
    },
    get not() {
      return makeExpect(actual, !negated);
    },
    get resolves() {
      return makeAsyncExpect(actual, negated, "resolves");
    },
    get rejects() {
      return makeAsyncExpect(actual, negated, "rejects");
    },
  };
  return api;
}

function makeAsyncExpect(promise, negated, kind) {
  return {
    async toMatchObject(exp) {
      if (kind === "resolves") {
        const v = await promise;
        makeExpect(v, negated).toMatchObject(exp);
      } else {
        let err = null;
        try {
          await promise;
        } catch (e) {
          err = e;
        }
        assert.ok(err !== null, "expected promise to reject");
      }
    },
    async toBe(exp) {
      if (kind === "resolves") {
        const v = await promise;
        makeExpect(v, negated).toBe(exp);
      } else {
        let err = null;
        try {
          await promise;
        } catch (e) {
          err = e;
        }
        assert.ok(err !== null, "expected promise to reject");
      }
    },
    async toThrow(exp) {
      let err = null;
      try {
        await promise;
      } catch (e) {
        err = e;
      }
      let pass = err !== null;
      if (pass && exp !== undefined) {
        const msg = err instanceof Error ? err.message : String(err);
        if (typeof exp === "string") pass = msg.includes(exp);
        else if (exp instanceof RegExp) pass = exp.test(msg);
      }
      if (negated) pass = !pass;
      assert.ok(pass, `expected promise rejects toThrow ${exp ?? ""}, got ${err}`);
    },
  };
}

export function expect(actual) {
  return makeExpect(actual);
}

export const vi = {
  fn: (impl) => {
    const f = (...args) => (impl ? impl(...args) : undefined);
    f.mock = { calls: [] };
    return f;
  },
  spyOn: () => {
    throw new Error("vi.spyOn chua duoc shim ho tro");
  },
};

export default { describe, it, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi };
