function test() {
    var x = <H>true;
    var y = true;
    var z = true;
    y = <H>!y;
    if (x)
        y = false;
    z = <H>!z;
    if (!y)
        z = false;
    return !z;
}
test();
