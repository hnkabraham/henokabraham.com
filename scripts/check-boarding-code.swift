// Reads QR matrices from standard input, rows of 0 and 1 with a blank line
// after each code, draws each at 4 px a module inside a 4-module quiet zone,
// and prints what Apple's Vision barcode reader decodes from it, one line a
// code ("NONE" when it finds nothing). Used by check-boarding-code.mjs.
import CoreGraphics
import Foundation
import Vision

var codes: [[[Bool]]] = [[]]
while let line = readLine() {
    if line.isEmpty { codes.append([]); continue }
    codes[codes.count - 1].append(line.map { $0 == "1" })
}
for modules in codes where !modules.isEmpty {
    let scale = 4, quiet = 4, size = (modules.count + quiet * 2) * scale
    var pixels = [UInt8](repeating: 255, count: size * size)
    for (y, row) in modules.enumerated() {
        for (x, dark) in row.enumerated() where dark {
            for dy in 0..<scale {
                for dx in 0..<scale {
                    pixels[((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx] = 0
                }
            }
        }
    }
    let image = CGImage(
        width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: size,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0),
        provider: CGDataProvider(data: Data(pixels) as CFData)!,
        decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    print(request.results?.first?.payloadStringValue ?? "NONE")
}
