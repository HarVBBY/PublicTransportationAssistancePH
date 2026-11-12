'use strict';
/** Binary min-heap of (priority, value) pairs, stored in parallel arrays. */
class MinHeap {
  constructor() { this.p = []; this.v = []; }

  get size() { return this.p.length; }

  push(priority, value) {
    const p = this.p, v = this.v;
    let i = p.length;
    p.push(priority); v.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (p[parent] <= priority) break;
      p[i] = p[parent]; v[i] = v[parent];
      i = parent;
    }
    p[i] = priority; v[i] = value;
  }

  /** Removes and returns the value with the smallest priority; also sets this.lastPriority. */
  pop() {
    const p = this.p, v = this.v;
    const top = v[0];
    this.lastPriority = p[0];
    const lp = p.pop();
    const lv = v.pop();
    const n = p.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        p[i] = p[c]; v[i] = v[c];
        i = c;
      }
      p[i] = lp; v[i] = lv;
    }
    return top;
  }
}
module.exports = { MinHeap };
