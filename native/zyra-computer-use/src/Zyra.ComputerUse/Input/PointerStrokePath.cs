using Zyra.ComputerUse.Protocol;

namespace Zyra.ComputerUse.Input;

// Distance pacing follows the supplied polyline. Missed frames must still visit
// every intervening vertex; jumping to the next sample would cut corners.
public sealed class PointerStrokePath
{
    public IReadOnlyList<PointerPathPoint> Points { get; }
    private readonly double[] _distances;
    private int _next = 1;

    public PointerStrokePath(PointerPathPoint[]? points)
    {
        if (points is null || points.Length is < 2 or > 512
            || points.Any(point => point is null || !double.IsFinite(point.X) || !double.IsFinite(point.Y)))
            throw new InvalidOperationException("Stroke requires 2 to 512 finite points.");
        Points = points.ToArray();
        _distances = new double[points.Length];
        for (var index = 1; index < points.Length; index++)
        {
            var dx = points[index].X - points[index - 1].X;
            var dy = points[index].Y - points[index - 1].Y;
            _distances[index] = _distances[index - 1] + Math.Sqrt(dx * dx + dy * dy);
        }
        if (!double.IsFinite(_distances[^1])) throw new InvalidOperationException("Stroke distance is invalid.");
    }

    public void Advance(double progress, Action<PointerPathPoint> apply)
    {
        var distance = Math.Clamp(progress, 0, 1) * _distances[^1];
        while (_next < Points.Count && _distances[_next] <= distance) apply(Points[_next++]);
        if (_next >= Points.Count) return;
        var from = Points[_next - 1];
        var to = Points[_next];
        var fraction = (distance - _distances[_next - 1]) / (_distances[_next] - _distances[_next - 1]);
        apply(new(from.X + (to.X - from.X) * fraction, from.Y + (to.Y - from.Y) * fraction));
    }
}
