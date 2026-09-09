using Zyra.ComputerUse.Input;
using Zyra.ComputerUse.Protocol;

internal static class PointerStrokePathTests
{
    internal static void Run()
    {
        foreach (var extent in new[] { 1, 1920, 2560, 3440, 7680 }) {
            var origin = -extent;
            for (var pixel = origin; pixel < 0; pixel++) {
                var normalized = AbsolutePointerCoordinates.Normalize(pixel, origin, extent);
                var actual = (int)Math.Floor(normalized * extent / 65_536d) + origin;
                if (actual != pixel) throw new Exception("Absolute input lost a physical pixel.");
            }
            foreach (var outside in new[] { origin - 1, 0 }) {
                try { AbsolutePointerCoordinates.Normalize(outside, origin, extent); throw new Exception("Outside input accepted."); }
                catch (InvalidOperationException) { }
            }
        }
        var vertices = new[] { new PointerPathPoint(0, 0), new(30, 0), new(30, 40), new(0, 40) };
        var path = new PointerStrokePath(vertices);
        var visited = new List<PointerPathPoint>();
        path.Advance(.2, visited.Add);
        if (visited[^1] != new PointerPathPoint(20, 0)) throw new Exception("Distance pacing is wrong.");
        path.Advance(.8, visited.Add);
        if (!visited.Contains(vertices[1]) || !visited.Contains(vertices[2]) || visited[^1] != new PointerPathPoint(20, 40))
            throw new Exception("An overdue frame cut a path corner.");
        path.Advance(1, visited.Add);
        if (visited[^1] != vertices[^1]) throw new Exception("Final vertex was lost.");
        var buttons = new List<uint>();
        var stop = new InputStopController(buttons.Add);
        visited.Clear();
        path = new PointerStrokePath(vertices);
        try {
            stop.WithButton(2, 4, () => path.Advance(1, point => {
                stop.ThrowIfStopped(); visited.Add(point); stop.Stop();
            }));
            throw new Exception("Cancelled stroke continued.");
        } catch (OperationCanceledException) { }
        if (visited.Count != 1 || !buttons.SequenceEqual(new uint[] { 2, 4 }))
            throw new Exception("Interrupted stroke retained the button or replayed a vertex.");
        foreach (var invalid in new PointerPathPoint[]?[] { null, [], [new(0, 0)], [new(0, 0), new(double.NaN, 0)], Enumerable.Repeat(new PointerPathPoint(0, 0), 513).ToArray() }) {
            try { _ = new PointerStrokePath(invalid); throw new Exception("Invalid path accepted."); }
            catch (InvalidOperationException) { }
        }
        visited.Clear();
        new PointerStrokePath([new(3, 4), new(3, 4), new(3, 4)]).Advance(1, visited.Add);
        if (visited.Count != 2 || visited.Any(point => point != new PointerPathPoint(3, 4)))
            throw new Exception("Zero-length segments are invalid.");
    }
}
