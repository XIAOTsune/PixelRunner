param(
  [Parameter(Mandatory = $true)]
  [string]$Source,

  [string]$OutputDir = "",

  [int]$MaxWidth = 2400
)

Add-Type -AssemblyName System.Drawing

$sourcePath = [System.IO.Path]::GetFullPath($Source)
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $PSScriptRoot "..\assets\space-fx\generated"
}
$outputPath = [System.IO.Path]::GetFullPath($OutputDir)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null

$csharp = @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Text;

public static class SpaceFxAssetBuilder
{
    private sealed class Frame
    {
        public int X;
        public int Y;
        public int W;
        public int H;
        public int Area;
        public double Energy;
        public string Type;
    }

    public static void Build(string sourcePath, string outputDir, int maxWidth)
    {
        using (var source = new Bitmap(sourcePath))
        {
            double scale = Math.Min(1.0, Math.Max(256.0, maxWidth) / Math.Max(1.0, source.Width));
            int width = Math.Max(1, (int)Math.Round(source.Width * scale));
            int height = Math.Max(1, (int)Math.Round(source.Height * scale));
            using (var scaled = new Bitmap(width, height, PixelFormat.Format32bppArgb))
            {
                using (var graphics = Graphics.FromImage(scaled))
                {
                    graphics.Clear(Color.Transparent);
                    graphics.CompositingQuality = CompositingQuality.HighQuality;
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    graphics.SmoothingMode = SmoothingMode.HighQuality;
                    graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    graphics.DrawImage(source, 0, 0, width, height);
                }

                var frames = DetectFrames(scaled);
                using (var atlas = BuildTransparentAtlas(scaled))
                {
                    string atlasPath = Path.Combine(outputDir, "smoke-atlas.png");
                    atlas.Save(atlasPath, ImageFormat.Png);
                }

                string jsonPath = Path.Combine(outputDir, "smoke-atlas.json");
                File.WriteAllText(jsonPath, BuildJson(width, height, scale, frames), Encoding.UTF8);
                Console.WriteLine("Built smoke atlas: " + Path.Combine(outputDir, "smoke-atlas.png"));
                Console.WriteLine("Built smoke metadata: " + jsonPath);
                Console.WriteLine("Frames: " + frames.Count.ToString(CultureInfo.InvariantCulture));
            }
        }
    }

    private static Bitmap BuildTransparentAtlas(Bitmap source)
    {
        int width = source.Width;
        int height = source.Height;
        var output = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                Color color = source.GetPixel(x, y);
                double luminance = color.R * 0.2126 + color.G * 0.7152 + color.B * 0.0722;
                double alphaNorm = SmoothStep(10.0, 92.0, luminance);
                alphaNorm = Math.Pow(alphaNorm, 0.82);
                int alpha = ClampToByte(alphaNorm * 255.0);
                int value = ClampToByte(luminance * 1.35 + 18.0);
                output.SetPixel(x, y, Color.FromArgb(alpha, value, value, value));
            }
        }
        return output;
    }

    private static List<Frame> DetectFrames(Bitmap source)
    {
        int width = source.Width;
        int height = source.Height;
        int stride = width;
        bool[] active = new bool[width * height];
        bool[] visited = new bool[width * height];
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                Color color = source.GetPixel(x, y);
                double luminance = color.R * 0.2126 + color.G * 0.7152 + color.B * 0.0722;
                if (luminance > 24.0) active[y * stride + x] = true;
            }
        }

        active = Dilate(active, width, height, 2);
        active = Erode(active, width, height, 1);

        var frames = new List<Frame>();
        var queue = new Queue<int>();
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                int start = y * stride + x;
                if (!active[start] || visited[start]) continue;
                int minX = x, maxX = x, minY = y, maxY = y, area = 0;
                double energy = 0.0;
                visited[start] = true;
                queue.Enqueue(start);
                while (queue.Count > 0)
                {
                    int current = queue.Dequeue();
                    int cx = current % stride;
                    int cy = current / stride;
                    area++;
                    if (cx < minX) minX = cx;
                    if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy;
                    if (cy > maxY) maxY = cy;
                    Color color = source.GetPixel(cx, cy);
                    energy += color.R * 0.2126 + color.G * 0.7152 + color.B * 0.0722;
                    Enqueue(cx - 1, cy, width, height, active, visited, queue);
                    Enqueue(cx + 1, cy, width, height, active, visited, queue);
                    Enqueue(cx, cy - 1, width, height, active, visited, queue);
                    Enqueue(cx, cy + 1, width, height, active, visited, queue);
                }

                int boxW = maxX - minX + 1;
                int boxH = maxY - minY + 1;
                bool touchesBorder = minX < 24 || minY < 24 || maxX > width - 25 || maxY > height - 25;
                if (touchesBorder || area < 90 || boxW < 18 || boxH < 18 || boxW > width * 0.32 || boxH > height * 0.32) continue;
                int pad = Math.Max(10, Math.Min(48, (int)Math.Round(Math.Max(boxW, boxH) * 0.18)));
                minX = Math.Max(0, minX - pad);
                minY = Math.Max(0, minY - pad);
                maxX = Math.Min(width - 1, maxX + pad);
                maxY = Math.Min(height - 1, maxY + pad);
                boxW = maxX - minX + 1;
                boxH = maxY - minY + 1;
                string type = boxW > boxH * 1.45 ? "streak" : boxH > boxW * 1.35 ? "column" : "cloud";
                frames.Add(new Frame {
                    X = minX,
                    Y = minY,
                    W = boxW,
                    H = boxH,
                    Area = area,
                    Energy = energy / Math.Max(1, area),
                    Type = type
                });
            }
        }

        frames.Sort((a, b) => {
            int row = a.Y.CompareTo(b.Y);
            if (Math.Abs(a.Y - b.Y) > 24) return row;
            return a.X.CompareTo(b.X);
        });
        return frames;
    }

    private static void Enqueue(int x, int y, int width, int height, bool[] active, bool[] visited, Queue<int> queue)
    {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        int index = y * width + x;
        if (!active[index] || visited[index]) return;
        visited[index] = true;
        queue.Enqueue(index);
    }

    private static bool[] Dilate(bool[] source, int width, int height, int radius)
    {
        var output = new bool[source.Length];
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                bool any = false;
                for (int dy = -radius; dy <= radius && !any; dy++)
                {
                    int yy = y + dy;
                    if (yy < 0 || yy >= height) continue;
                    for (int dx = -radius; dx <= radius; dx++)
                    {
                        int xx = x + dx;
                        if (xx < 0 || xx >= width) continue;
                        if (source[yy * width + xx]) { any = true; break; }
                    }
                }
                output[y * width + x] = any;
            }
        }
        return output;
    }

    private static bool[] Erode(bool[] source, int width, int height, int radius)
    {
        var output = new bool[source.Length];
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                bool all = true;
                for (int dy = -radius; dy <= radius && all; dy++)
                {
                    int yy = y + dy;
                    if (yy < 0 || yy >= height) { all = false; break; }
                    for (int dx = -radius; dx <= radius; dx++)
                    {
                        int xx = x + dx;
                        if (xx < 0 || xx >= width || !source[yy * width + xx]) { all = false; break; }
                    }
                }
                output[y * width + x] = all;
            }
        }
        return output;
    }

    private static string BuildJson(int width, int height, double scale, List<Frame> frames)
    {
        var builder = new StringBuilder();
        builder.Append("{\n");
        builder.AppendFormat(CultureInfo.InvariantCulture, "  \"image\": \"smoke-atlas.png\",\n  \"width\": {0},\n  \"height\": {1},\n  \"sourceScale\": {2:0.######},\n  \"frames\": [\n", width, height, scale);
        for (int i = 0; i < frames.Count; i++)
        {
            Frame f = frames[i];
            builder.AppendFormat(CultureInfo.InvariantCulture,
                "    {{ \"id\": \"smoke-{0:00}\", \"x\": {1}, \"y\": {2}, \"w\": {3}, \"h\": {4}, \"type\": \"{5}\", \"energy\": {6:0.###} }}{7}\n",
                i + 1, f.X, f.Y, f.W, f.H, f.Type, f.Energy, i == frames.Count - 1 ? "" : ",");
        }
        builder.Append("  ]\n}\n");
        return builder.ToString();
    }

    private static double SmoothStep(double edge0, double edge1, double value)
    {
        double x = Math.Max(0.0, Math.Min(1.0, (value - edge0) / Math.Max(0.00001, edge1 - edge0)));
        return x * x * (3.0 - 2.0 * x);
    }

    private static int ClampToByte(double value)
    {
        if (value < 0.0) return 0;
        if (value > 255.0) return 255;
        return (int)Math.Round(value);
    }
}
"@

Add-Type -TypeDefinition $csharp -ReferencedAssemblies System.Drawing
[SpaceFxAssetBuilder]::Build($sourcePath, $outputPath, $MaxWidth)
