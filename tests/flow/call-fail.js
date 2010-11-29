function test() {
    var foo = <H>(function () { return true; });
    var y;
    if (foo())
        y = false;
    return !y;
}

test();
