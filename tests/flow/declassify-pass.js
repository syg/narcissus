function test() {
    var x = <HH>true;
    var y;
    if (x) {
        y = declassify(x, <LH>);
    }
}
test();
