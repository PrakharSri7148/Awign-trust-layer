// A small in-place radix-2 FFT (double precision) and a 2-D wrapper. N must be a power of two.
export const isPow2 = (n) => n >= 2 && (n & (n - 1)) === 0
export const floorPow2 = (n) => 2 ** Math.floor(Math.log2(Math.max(1, n)))

export function fft1d(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr; im[b] = im[a] - xi
        re[a] += xr; im[a] += xi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

// 2-D FFT of an n x n real image (row-major Float64Array) -> magnitude spectrum (row-major, DC at [0]).
export function fftMagnitude2d(img, n) {
  const re = new Float64Array(n * n)
  const im = new Float64Array(n * n)
  re.set(img)
  const rr = new Float64Array(n)
  const ri = new Float64Array(n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) { rr[x] = re[y * n + x]; ri[x] = im[y * n + x] }
    fft1d(rr, ri)
    for (let x = 0; x < n; x++) { re[y * n + x] = rr[x]; im[y * n + x] = ri[x] }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) { rr[y] = re[y * n + x]; ri[y] = im[y * n + x] }
    fft1d(rr, ri)
    for (let y = 0; y < n; y++) { re[y * n + x] = rr[y]; im[y * n + x] = ri[y] }
  }
  const mag = new Float64Array(n * n)
  for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i])
  return mag
}
