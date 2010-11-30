function test() {
    var foo = <HL>(function () { return true; });
    var y;
    if (foo())
        y = false;
    return !y;
}

test();
