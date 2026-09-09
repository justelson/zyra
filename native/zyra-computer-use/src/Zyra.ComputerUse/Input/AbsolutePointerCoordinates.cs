namespace Zyra.ComputerUse.Input;

public static class AbsolutePointerCoordinates
{
    public static int Normalize(int pixel, int origin, int extent)
    {
        var offset = (long)pixel - origin;
        if (extent < 1 || offset < 0 || offset >= extent)
            throw new InvalidOperationException("Pointer point is outside the virtual desktop.");
        // Aim at the center of the pixel's absolute-coordinate interval, so
        // truncation on the Windows side preserves the requested physical pixel.
        return (int)Math.Clamp(Math.Round((offset + .5) * 65_536d / extent), 0, 65_535);
    }
}
