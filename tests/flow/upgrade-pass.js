function test() {
    var x = <HT>true;
    var y = true;
    var z = true;
    y = <HT>!y;
    if (x)
        y = false;
    z = <HT>!z;
    if (!y)
        z = false;
    return !z;
}
test();
