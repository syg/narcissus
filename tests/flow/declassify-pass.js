function test() {
    var x = <HU>true;
    var y;
    if (x) {
        y = declassify(x, <LU>);
    }
}
test();
