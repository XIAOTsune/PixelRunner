# RealESRGAN

PixelRunner bundles and supports one fixed model:

- `realesrgan-x4plus`

The local service invokes the portable NCNN Vulkan executable with the model's
native 4x scale. Other upstream Real-ESRGAN models are intentionally not bundled.

Example command:

    ./realesrgan-ncnn-vulkan.exe -i input.png -o output.png -n realesrgan-x4plus -s 4 -f png

------------------------

GitHub: https://github.com/xinntao/Real-ESRGAN/
Paper: https://arxiv.org/abs/2107.10833

------------------------

This executable file is **portable** and does not require CUDA or PyTorch.

Note that it may introduce block inconsistency (and also generate slightly different results from the PyTorch implementation), because this executable file first crops the input image into several tiles, and then processes them separately, finally stitches together.

This executable file is based on the wonderful [Tencent/ncnn](https://github.com/Tencent/ncnn) and [realsr-ncnn-vulkan](https://github.com/nihui/realsr-ncnn-vulkan) by [nihui](https://github.com/nihui).
