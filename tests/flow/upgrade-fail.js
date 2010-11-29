function test() {
    var x = <H>true;
    var y = true;
    var z = true;
    if (x)
        y = false;
    if (!y)
        z = false;
    return !z;
}
test();
